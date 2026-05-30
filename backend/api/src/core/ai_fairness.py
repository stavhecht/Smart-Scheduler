"""
AI-powered fairness scoring — primary scorer.

This module wraps an OpenAI gpt-4o-mini agent that takes:
  - heuristic candidate slots (used only as a sanity-check reference)
  - each participant's historical fairness scores + load metrics
  - each participant's Google Calendar events for the meeting horizon

…and emits a PRIMARY fairness verdict per candidate slot, identifies the single
best slot with a rationale, and suggests concrete calendar-event changes that
would unlock even better options.

The AI's score is the score the user sees. The heuristic score is only used
as a fallback if the AI call fails (OpenAI down, no API key, parse error).

Runtime model: gpt-4o-mini (cheap, fast, JSON-mode output).
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

from src.common.openai_client import _norm_iso, _redact_events

logger = logging.getLogger(__name__)

# AI call budget: cap input context to avoid runaway cost on huge groups
MAX_PARTICIPANTS_FOR_AI = 25
MAX_EVENTS_PER_PARTICIPANT = 40
MAX_HISTORY_ENTRIES = 20

MODEL_ID = os.environ.get("AI_FAIRNESS_MODEL", "gpt-4o-mini")


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are the Smart Scheduler AI Analyst. Your scores are shown DIRECTLY to users
as the primary fairness verdict for candidate meeting slots — there is no
heuristic post-processing.

You receive:
  1. Candidate time slots, each with a reference heuristic pre-score (guidance
     only — use your own judgment).
  2. Each participant's current fairness score, weekly load, and recent
     fairness trend.
  3. Each participant's calendar density around the proposed slots (event
     details anonymized — only start/end/duration/attendee_count provided).

Your job:
  A. Score every slot 0–100 based on overall fairness for the GROUP.
  B. Pick the SINGLE best slot and explain in 2–3 sentences why (mention which
     participants benefit and how the slot avoids burdens).
  C. Suggest 2–4 SPECIFIC, ACTIONABLE calendar changes participants could make
     to unlock even better slots (e.g. "If Alice moves her recurring Tuesday
     1:1 to a different day, the Tuesday 10am slot would gain ~12 points
     because she would be coming off a focus block rather than a meeting").
     Refer to participants by their userId. Suggestions must be concrete and
     reference specific days/times.

SCORING CRITERIA:
  - Time-of-day fairness (prime working hours vs. fringe hours per timezone)
  - Load balance (do not pile onto someone already overloaded this week)
  - Calendar context (avoid creating back-to-back chains, respect focus blocks)
  - Historical equity (someone consistently absorbing bad slots is unfair)
  - Inclusion (every participant should have at least one workable option)

PRIVACY RULES:
  - NEVER mention event titles, attendee names, or emails — you do not have
    them and must not invent them. Refer to events generically: "a focus
    block", "back-to-back meetings", "a 1:1".

OUTPUT STRICT JSON ONLY — no markdown, no prose outside the JSON:
{
  "meeting_fairness_score": <0-100 float — average quality of the slate>,
  "summary": "<one concise sentence — overall verdict on the slate>",
  "best_slot": "<startIso of the single best slot, must match an input slot exactly>",
  "best_slot_reason": "<2-3 sentences — why this is the best, who benefits>",
  "calendar_suggestions": [
    "<specific actionable suggestion 1>",
    "<specific actionable suggestion 2>"
  ],
  "slot_scores": [
    {
      "startIso": "<must match an input slot exactly>",
      "ai_score": <0-100 float>,
      "description": "<one sentence — why this slot scores as it does>"
    }
  ]
}
"""


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
                "heuristic_reference_score": float(s.get("score", 0.0)),
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
                "fairness_trend": p.get("fairness_trend", [])[:MAX_HISTORY_ENTRIES],
                "calendar_density": _redact_events(
                    p.get("calendar_events", []),
                    max_events=MAX_EVENTS_PER_PARTICIPANT,
                    include_attendee_count=True,
                ),
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

    Returns the parsed JSON dict on success, or None if the call fails —
    caller must fall back to heuristic scores so the meeting flow never breaks.
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
            max_tokens=2000,
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
# Helpers
# ---------------------------------------------------------------------------

def _heuristic_fallback(
    candidate_slots: List[dict],
    reason: str = "AI scoring unavailable — heuristic scores used as fallback.",
) -> Dict[str, Any]:
    """Produce a fallback result using only the heuristic scores."""
    if not candidate_slots:
        return {
            "method": "heuristic_fallback",
            "model": MODEL_ID,
            "meeting_fairness_score": 0.0,
            "summary": reason,
            "best_slot": "",
            "best_slot_reason": "",
            "calendar_suggestions": [],
            "slot_scores": [],
        }
    avg = round(sum(float(s.get("score", 0)) for s in candidate_slots) / len(candidate_slots), 1)
    best = max(candidate_slots, key=lambda s: float(s.get("score", 0)))
    return {
        "method": "heuristic_fallback",
        "model": MODEL_ID,
        "meeting_fairness_score": avg,
        "summary": reason,
        "best_slot": str(best.get("startIso", "")),
        "best_slot_reason": best.get("explanation", "Top-ranked slot by the heuristic scorer."),
        "calendar_suggestions": [],
        "slot_scores": [
            {
                "startIso": str(s.get("startIso", "")),
                "ai_score": float(s.get("score", 0.0)),
                "description": s.get("explanation", ""),
            }
            for s in candidate_slots
        ],
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def score_meeting_with_ai(
    request_id: str,
    candidate_slots: List[dict],
    participants: List[dict],
) -> Dict[str, Any]:
    """
    Run the AI fairness pass on a meeting. AI is the PRIMARY scorer — heuristic
    scores are only used if the AI call fails.

    Args:
        request_id: meeting requestId (for logging only)
        candidate_slots: list of dicts with startIso, score (heuristic
            reference), explanation, conflictCount.
        participants: list of dicts with userId, timezone,
            current_fairness_score, meetings_this_week, fairness_trend,
            calendar_events.

    Returns:
        {
            "method": "ai" | "heuristic_fallback",
            "model": str,
            "meeting_fairness_score": float,
            "summary": str,
            "best_slot": str (startIso),
            "best_slot_reason": str,
            "calendar_suggestions": [str],
            "slot_scores": [{startIso, ai_score, description}],
        }
    """
    if not candidate_slots:
        return _heuristic_fallback([], "No candidate slots to score.")

    user_prompt = _build_user_prompt(candidate_slots, participants)
    ai = _call_openai(user_prompt)

    if not ai:
        return _heuristic_fallback(candidate_slots)

    # Map AI per-slot scores back to input slots (match by normalized startIso)
    ai_by_start: Dict[str, dict] = {}
    for entry in ai.get("slot_scores", []) or []:
        key = _norm_iso(entry.get("startIso"))
        if key:
            ai_by_start[key] = entry

    slot_scores_out: List[dict] = []
    for s in candidate_slots:
        start_raw = str(s.get("startIso", ""))
        key = _norm_iso(start_raw)
        heuristic = float(s.get("score", 0.0))
        ai_entry = ai_by_start.get(key, {})

        # Use AI score directly if present, else fall back to heuristic for this slot
        try:
            ai_score = float(ai_entry.get("ai_score")) if ai_entry.get("ai_score") is not None else heuristic
        except (TypeError, ValueError):
            ai_score = heuristic

        ai_score = max(0.0, min(100.0, round(ai_score, 1)))
        slot_scores_out.append({
            "startIso": start_raw,
            "ai_score": ai_score,
            "description": str(ai_entry.get("description") or s.get("explanation", ""))[:500],
        })

    # Resolve best_slot — AI's choice if it matches an input slot, else top by ai_score
    best_iso = _norm_iso(ai.get("best_slot", ""))
    best_match = next(
        (entry for entry in slot_scores_out if _norm_iso(entry["startIso"]) == best_iso),
        None,
    )
    if not best_match and slot_scores_out:
        best_match = max(slot_scores_out, key=lambda e: e["ai_score"])

    suggestions_raw = ai.get("calendar_suggestions", []) or []
    suggestions = [str(s)[:400] for s in suggestions_raw if str(s).strip()][:4]

    logger.info(
        f"[ai_fairness] request_id={request_id} method=ai slots={len(slot_scores_out)} "
        f"best={best_match['startIso'] if best_match else 'n/a'} suggestions={len(suggestions)}"
    )

    return {
        "method": "ai",
        "model": MODEL_ID,
        "meeting_fairness_score": float(ai.get("meeting_fairness_score", 0.0)),
        "summary": str(ai.get("summary", ""))[:280],
        "best_slot": best_match["startIso"] if best_match else "",
        "best_slot_reason": str(ai.get("best_slot_reason", ""))[:600],
        "calendar_suggestions": suggestions,
        "slot_scores": slot_scores_out,
    }
