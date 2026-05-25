"""
AI-powered fairness scoring (Method B / Method C of the fairness system).

This module wraps an OpenAI gpt-4o-mini agent that takes:
  - the heuristic fairness output from `fairness.py` (Method A)
  - each participant's historical fairness scores + decision-influence trends
  - each participant's Google Calendar events for the meeting horizon

…and emits a calibrated fairness verdict per candidate slot, plus a single
"meeting fairness score" that captures whether the proposed slots are equitable
across the group as a whole.

The agent is intentionally instructed to RESPECT the existing heuristic score —
it can adjust within a bounded delta, but cannot wholesale override Method A.
This gives us Method C (hybrid blend) for free.

Runtime model: gpt-4o-mini (cheap, fast, supports structured JSON output).
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Bounded blend: AI may shift a slot's heuristic score by at most ±AI_MAX_DELTA
AI_MAX_DELTA = 15.0

# AI call budget: cap input context to avoid runaway cost on huge groups
MAX_PARTICIPANTS_FOR_AI = 25
MAX_EVENTS_PER_PARTICIPANT = 40
MAX_HISTORY_ENTRIES = 20

MODEL_ID = os.environ.get("AI_FAIRNESS_MODEL", "gpt-4o-mini")


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are the Smart Scheduler Fairness Auditor. Your job is to review a set of
candidate meeting time slots that a heuristic scheduler has already scored, and
to issue a calibrated fairness verdict that accounts for:

  1. Each participant's historical fairness score trend (are they consistently
     absorbing inconvenient meetings? are they over-loaded this week?).
  2. Each participant's calendar density and the type of events around the
     proposed slot (deep-work blocks vs. back-to-back meetings).
  3. Decision-making equity — does the same person keep getting prime slots
     while others get pushed to fringe hours?
  4. Inclusion — does every participant have at least one workable option in
     their local working hours?

CRITICAL RULES:
- The heuristic score (Method A) is the source of truth for time-of-day and
  load mechanics. You are ALLOWED to nudge it by at most ±15 points based on
  the additional context. Do not invent large swings.
- Never reveal calendar event TITLES verbatim — they may be sensitive. Refer
  to events generically ("a focus block", "back-to-back meetings", "a
  recurring 1:1").
- Output STRICT JSON only. No markdown, no prose outside the JSON.

Output schema:
{
  "meeting_fairness_score": <0-100 float>,
  "summary": "<one short sentence>",
  "slot_scores": [
    {
      "startIso": "<iso>",
      "ai_score": <0-100 float>,
      "delta_vs_heuristic": <float, must be within [-15, 15]>,
      "rationale": "<one short sentence, no event titles>"
    }
  ],
  "participant_equity": [
    {"userId": "<id>", "burden_assessment": "low|balanced|elevated|overloaded"}
  ]
}
"""


def _event_duration_minutes(ev: dict) -> Optional[int]:
    from datetime import datetime
    try:
        start = ev.get("start", "")
        end = ev.get("end", "")
        if not start or not end:
            return None
        s = datetime.fromisoformat(start.replace("Z", "+00:00"))
        e = datetime.fromisoformat(end.replace("Z", "+00:00"))
        return max(0, int((e - s).total_seconds() // 60))
    except Exception:
        return None


def _redact_events(events: List[dict]) -> List[dict]:
    """Strip sensitive fields from calendar events before sending to the LLM."""
    redacted = []
    for ev in events[:MAX_EVENTS_PER_PARTICIPANT]:
        redacted.append({
            "start": ev.get("start", ""),
            "end": ev.get("end", ""),
            "duration_min": _event_duration_minutes(ev),
            "attendee_count": len(ev.get("attendees", []) or []),
        })
    return redacted


def _build_user_prompt(
    candidate_slots: List[dict],
    participants: List[dict],
) -> str:
    """Build the JSON payload sent to the agent."""
    truncated = participants[:MAX_PARTICIPANTS_FOR_AI]
    body = {
        "candidate_slots": [
            {
                "startIso": s.get("startIso"),
                "heuristic_score": float(s.get("score", 0.0)),
                "heuristic_explanation": s.get("explanation", ""),
                "conflictCount": int(s.get("conflictCount", 0)),
            }
            for s in candidate_slots
        ],
        "participants": [
            {
                "userId": p.get("userId", ""),
                "timezone": p.get("timezone", "UTC"),
                "current_fairness_score": float(p.get("current_fairness_score", 100.0)),
                "meetings_this_week": int(p.get("meetings_this_week", 0)),
                "suffering_score": int(p.get("suffering_score", 0)),
                "fairness_trend": p.get("fairness_trend", [])[:MAX_HISTORY_ENTRIES],
                "calendar_density": _redact_events(p.get("calendar_events", [])),
            }
            for p in truncated
        ],
    }
    return json.dumps(body, separators=(",", ":"))


# ---------------------------------------------------------------------------
# OpenAI invocation
# ---------------------------------------------------------------------------

def _call_openai(user_prompt: str) -> Optional[dict]:
    """Invoke gpt-4o-mini with JSON-mode structured output.

    Returns the parsed JSON dict on success, or None if the call fails — caller
    must fall back to the heuristic-only blend so the meeting flow never breaks.
    """
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        logger.warning("[ai_fairness] OPENAI_API_KEY not set — skipping AI scoring")
        return None

    try:
        from openai import OpenAI
    except ImportError:
        logger.warning("[ai_fairness] openai package not available — skipping AI scoring")
        return None

    client = OpenAI(api_key=api_key)
    try:
        resp = client.chat.completions.create(
            model=MODEL_ID,
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=1500,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )
        content = resp.choices[0].message.content or ""
        return json.loads(content)
    except Exception as exc:
        logger.warning(f"[ai_fairness] OpenAI call failed: {exc}")
        return None


# ---------------------------------------------------------------------------
# Hybrid blend (Method C)
# ---------------------------------------------------------------------------

def _blend(heuristic: float, ai_score: Optional[float]) -> float:
    """Bounded blend so the AI cannot wholesale override the heuristic."""
    if ai_score is None:
        return heuristic
    delta = max(-AI_MAX_DELTA, min(AI_MAX_DELTA, ai_score - heuristic))
    return round(max(0.0, min(100.0, heuristic + delta)), 1)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def score_meeting_with_ai(
    request_id: str,
    candidate_slots: List[dict],
    participants: List[dict],
) -> Dict[str, Any]:
    """
    Run the AI fairness pass on a meeting.

    Args:
        request_id: meeting requestId (for logging only)
        candidate_slots: output of `fairness.engine.score_time_slot` — each item
            must have startIso, score, explanation, conflictCount.
        participants: list of dicts with userId, timezone,
            current_fairness_score, meetings_this_week, suffering_score,
            fairness_trend (list of past scores), calendar_events (Google).

    Returns:
        {
            "method": "ai" | "heuristic_fallback",
            "model": str,
            "meeting_fairness_score": float,
            "summary": str,
            "slot_scores": [{startIso, heuristic_score, ai_score, blended_score, rationale}],
            "participant_equity": [{userId, burden_assessment}],
        }
    """
    user_prompt = _build_user_prompt(candidate_slots, participants)
    ai = _call_openai(user_prompt)

    if not ai:
        # Heuristic fallback — keep the meeting flow alive even if OpenAI is down
        return {
            "method": "heuristic_fallback",
            "model": MODEL_ID,
            "meeting_fairness_score": (
                round(sum(float(s.get("score", 0)) for s in candidate_slots) / len(candidate_slots), 1)
                if candidate_slots else 0.0
            ),
            "summary": "AI scoring unavailable — using heuristic average.",
            "slot_scores": [
                {
                    "startIso": s.get("startIso"),
                    "heuristic_score": float(s.get("score", 0.0)),
                    "ai_score": None,
                    "blended_score": float(s.get("score", 0.0)),
                    "rationale": s.get("explanation", ""),
                }
                for s in candidate_slots
            ],
            "participant_equity": [],
        }

    # Map AI per-slot scores back by startIso
    ai_by_start = {entry.get("startIso"): entry for entry in ai.get("slot_scores", [])}
    blended_slots = []
    for s in candidate_slots:
        start = s.get("startIso")
        heuristic = float(s.get("score", 0.0))
        ai_entry = ai_by_start.get(start, {})
        ai_score = ai_entry.get("ai_score")
        try:
            ai_score_f = float(ai_score) if ai_score is not None else None
        except (TypeError, ValueError):
            ai_score_f = None
        blended_slots.append({
            "startIso": start,
            "heuristic_score": heuristic,
            "ai_score": ai_score_f,
            "blended_score": _blend(heuristic, ai_score_f),
            "rationale": ai_entry.get("rationale", s.get("explanation", "")),
        })

    return {
        "method": "ai",
        "model": MODEL_ID,
        "meeting_fairness_score": float(ai.get("meeting_fairness_score", 0.0)),
        "summary": str(ai.get("summary", ""))[:280],
        "slot_scores": blended_slots,
        "participant_equity": ai.get("participant_equity", []),
    }
