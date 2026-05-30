"""
Minimal OpenAI client for AI-powered fairness scoring.

Uses stdlib urllib to avoid bundling the openai SDK in the Lambda zip.
Single batched call per meeting: all candidate slots are scored AND a
meeting-wide strategic summary is produced in one round trip. Designed to be
fast-fail with a hard token cap so the SFN can fall back to the deterministic
engine on any error.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.request
import urllib.error
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
# gpt-4.1-nano: cheapest non-reasoning model — no hidden reasoning_tokens cost,
# fast, and reliable JSON-mode output. gpt-5-nano was tested but burns the entire
# token budget on hidden reasoning before producing visible output.
MODEL = "gpt-4.1-nano"
REQUEST_TIMEOUT_SECONDS = 15.0
MAX_OUTPUT_TOKENS = 2500          # Per-meeting hard cap (slots + summary in one call)
TEMPERATURE = 0.3                 # Low temperature → consistent fairness verdicts
MAX_SLOTS_SENT = 30               # Truncate input slots to bound token usage
MAX_EVENTS_PER_PARTICIPANT = 25   # Cap calendar event context per person
MAX_HISTORY_ENTRIES = 10          # Cap fairness trend history per person


class OpenAIScoreError(Exception):
    """Raised when AI scoring cannot produce a usable result."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _norm_iso(s: Any) -> str:
    """Normalize ISO string for robust matching — strip 'Z'/'+00:00'/fractional secs."""
    if not s:
        return ""
    s = str(s).split("+")[0].split("Z")[0].split(".")[0]
    return s.strip()


def _event_duration_minutes(start: str, end: str) -> Optional[int]:
    try:
        if not start or not end:
            return None
        s = datetime.fromisoformat(start.replace("Z", "+00:00"))
        e = datetime.fromisoformat(end.replace("Z", "+00:00"))
        return max(0, int((e - s).total_seconds() // 60))
    except Exception:
        return None


def _redact_events(
    events: List[dict],
    max_events: int = MAX_EVENTS_PER_PARTICIPANT,
    include_attendee_count: bool = False,
) -> List[dict]:
    """Strip sensitive fields from busy intervals — keep only timing density.

    Shared by the SFN-side scorer and the inline ai_fairness scorer; the latter
    passes a larger cap and asks for attendee_count.
    """
    out = []
    for ev in (events or [])[:max_events]:
        start = ev.get("start", "")
        end = ev.get("end", "")
        item = {
            "start": start,
            "end": end,
            "duration_min": _event_duration_minutes(start, end),
        }
        if include_attendee_count:
            item["attendee_count"] = len(ev.get("attendees", []) or [])
        out.append(item)
    return out


def _post(api_key: str, body: Dict[str, Any]) -> Dict[str, Any]:
    req = urllib.request.Request(
        OPENAI_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------------------------------------------------------------------------
# Combined scoring + summary
# ---------------------------------------------------------------------------

_SCORING_SYSTEM_PROMPT = """\
You are the Smart Scheduler AI fairness analyst. Your output is shown DIRECTLY
to users — your per-slot scores override the heuristic baseline and your
meeting-wide summary is the headline verdict.

You receive:
  1. Candidate time slots with a heuristic_baseline_score (guidance only).
  2. Each participant's current fairness state, weekly load,
     recent fairness trend, and a REDACTED calendar density window (start/end/
     duration only — no titles, no names, no emails).
  3. The meeting duration.

For each slot, produce a fairness score 0-100 (override the baseline), a
one-sentence explanation, and a one-sentence concrete suggestion about
moving an existing event to unlock a better slot (e.g. "move your Tue 14:00
event to Wed afternoon").

Then produce a meeting-wide summary:
  - meetingScore: average quality across the slate (0-100)
  - summary: one sentence overall verdict
  - bestSlotIso: startIso of the single best slot — MUST match an input slot
  - bestSlotReason: 2-3 sentences on why it is best and who benefits (refer to
    participants by their displayName field, e.g. "Alice benefits because...")
  - calendarSuggestions: 2-4 SPECIFIC actionable changes participants could
    make to unlock even better slots. Each must reference a participant by
    displayName and a specific day/time (e.g. "Alice could shift her Tuesday
    13:00 event so Tue 14:00 becomes high-quality for the group").

PRIVACY: never mention event titles or attendee emails — refer to events
generically ("a focus block", "a back-to-back meeting"). Participant
displayNames ARE allowed in the summary and suggestions.

Respond ONLY with valid JSON of the form:
{
  "slots": [{"startIso": "...", "score": 0-100, "explanation": "...", "suggestions": "..."}],
  "meeting": {
    "meetingScore": 0-100,
    "summary": "...",
    "bestSlotIso": "...",
    "bestSlotReason": "...",
    "calendarSuggestions": ["...", "..."]
  }
}
Include every slot in the same order received."""


def score_slots_with_ai(
    slots: List[Dict[str, Any]],
    participants: List[Dict[str, Any]],
    duration_minutes: int,
) -> Dict[str, Any]:
    """
    Score all candidate slots AND produce a meeting-wide strategic summary in
    a single OpenAI call.

    Returns: {
        "slots": {startIso: {score, explanation, suggestions}},
        "meeting": {meetingScore, summary, bestSlotIso, bestSlotReason, calendarSuggestions[]},
    }
    Raises OpenAIScoreError on any failure (caller falls back to engine).
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise OpenAIScoreError("OPENAI_API_KEY not set")
    if not slots:
        return {"slots": {}, "meeting": None}

    trimmed_slots = slots[:MAX_SLOTS_SENT]
    user_payload = {
        "duration_minutes": duration_minutes,
        "participants": participants,
        "slots": trimmed_slots,
    }
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": _SCORING_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user_payload, default=str)},
        ],
        "max_completion_tokens": MAX_OUTPUT_TOKENS,
        "temperature": TEMPERATURE,
        "response_format": {"type": "json_object"},
    }

    try:
        resp = _post(api_key, body)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")[:300]
        raise OpenAIScoreError(f"HTTP {e.code}: {detail}")
    except urllib.error.URLError as e:
        raise OpenAIScoreError(f"network error: {e.reason}")
    except Exception as e:
        raise OpenAIScoreError(f"unexpected: {e}")

    try:
        content = resp["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        ai_slots = parsed.get("slots", []) or []
        ai_meeting = parsed.get("meeting") or {}
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise OpenAIScoreError(f"bad response shape: {e}")

    # Per-slot output — key by normalized ISO so matching is robust to format drift
    out_slots: Dict[str, Dict[str, Any]] = {}
    for s in ai_slots:
        start_iso = s.get("startIso")
        if not start_iso:
            continue
        try:
            score = float(s.get("score", 0))
        except (TypeError, ValueError):
            continue
        out_slots[_norm_iso(start_iso)] = {
            "score": max(0.0, min(100.0, score)),
            "explanation": str(s.get("explanation", "")).strip() or "AI-scored slot.",
            "suggestions": str(s.get("suggestions", "")).strip() or None,
        }

    if not out_slots:
        raise OpenAIScoreError("AI returned no usable slot scores")

    # Meeting-wide summary — best-effort, never blocks per-slot output
    summary = None
    if ai_meeting:
        try:
            meeting_score = float(ai_meeting.get("meetingScore", 0))
        except (TypeError, ValueError):
            meeting_score = 0.0
        best_iso = _norm_iso(ai_meeting.get("bestSlotIso", ""))
        # Map normalized best back to original startIso format that we'll persist
        best_original = None
        for s in trimmed_slots:
            if _norm_iso(s.get("startIso")) == best_iso:
                best_original = s.get("startIso")
                break
        cal_sugg = [
            str(x).strip()[:400]
            for x in (ai_meeting.get("calendarSuggestions") or [])
            if str(x).strip()
        ][:4]
        summary = {
            "meetingScore": max(0.0, min(100.0, meeting_score)),
            "summary": str(ai_meeting.get("summary", "")).strip()[:300],
            "bestSlotIso": best_original or "",
            "bestSlotReason": str(ai_meeting.get("bestSlotReason", "")).strip()[:600],
            "calendarSuggestions": cal_sugg,
        }

    return {"slots": out_slots, "meeting": summary}


# ---------------------------------------------------------------------------
# Natural-language meeting parser
# ---------------------------------------------------------------------------

def parse_meeting_intent(text: str, today_iso: str, known_users: List[Dict[str, str]]) -> Dict[str, Any]:
    """Parse a free-text meeting request into structured fields."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise OpenAIScoreError("OPENAI_API_KEY not set")
    if not text or not text.strip():
        raise OpenAIScoreError("empty text")

    user_hints = [
        {"name": u.get("displayName") or u.get("name") or "", "email": u.get("email", "")}
        for u in known_users[:100]
    ]

    system = (
        f"Convert a meeting request to JSON. Today is {today_iso}; resolve all relative dates against it. "
        "Respond with ONLY this JSON object:\n"
        '{"title": str, "durationMinutes": int 15-480, "daysForward": int 1-90, '
        '"dateRangeStart": "YYYY-MM-DD" or null, '
        '"timeWindow": "all"|"morning"|"afternoon"|"evening", '
        '"excludedWeekdays": [int 0-6, ...], '
        '"description": str, "participantHints": [str, ...]}\n\n'
        "Rules:\n"
        "- title: short topic-based headline (e.g. 'Sync with Sarah', 'Design review'). Required.\n"
        "- durationMinutes: 'quick'=15, 'sync'=30, 'meeting'=60, 'workshop'=120. Default 60.\n"
        "- dateRangeStart: explicit anchor day as YYYY-MM-DD, else null. "
        "'tomorrow'→today+1; 'next Monday'/'next week'→Monday of next week; "
        "'on Friday'→next Friday; 'June 15'→next June 15; 'in 2 weeks'→today+14.\n"
        "- daysForward: search-window width from the anchor (or today if null). "
        "Single named day=1, 'this week'=5, 'next week'=7, 'in 2 weeks'=3, 'this month'=30, 'asap'=3. Default 7.\n"
        "- timeWindow: morning≈8–12, afternoon≈12–17, evening≈17–20. "
        "'early'/'before noon'→morning; 'after lunch'→afternoon; 'tonight'/'after work'/'late'→evening. Default 'all'.\n"
        "- excludedWeekdays: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6. "
        "'no weekends'/'weekdays only'→[5,6]; 'weekends only'→[0,1,2,3,4]; 'avoid Tuesdays'→[1]. "
        "Never exclude a day the user is requesting (e.g. 'meeting on Friday' must NOT include 4). Default [].\n"
        "- description: 1-3 line agenda/purpose if the user gave any ('to discuss X', 'about Y'). Else empty.\n"
        "- participantHints: names/emails EXPLICITLY mentioned. Match loosely against the contacts list and return "
        "the matched displayName or email. Empty list if no person mentioned — never guess."
    )

    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps({"request": text, "contacts": user_hints})},
        ],
        "max_completion_tokens": 600,
        "temperature": TEMPERATURE,
        "response_format": {"type": "json_object"},
    }

    try:
        resp = _post(api_key, body)
        content = resp["choices"][0]["message"]["content"]
        parsed = json.loads(content)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")[:300]
        raise OpenAIScoreError(f"HTTP {e.code}: {detail}")
    except urllib.error.URLError as e:
        raise OpenAIScoreError(f"network error: {e.reason}")
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise OpenAIScoreError(f"bad response: {e}")

    def _clamp(n, lo, hi, default):
        try:
            v = int(n)
            return max(lo, min(hi, v))
        except (TypeError, ValueError):
            return default

    def _valid_future_date(s: Any) -> Optional[str]:
        if not s or not isinstance(s, str):
            return None
        try:
            d = datetime.strptime(s.strip()[:10], "%Y-%m-%d").date()
        except ValueError:
            return None
        try:
            today = datetime.strptime(today_iso, "%Y-%m-%d").date()
        except ValueError:
            today = datetime.utcnow().date()
        delta = (d - today).days
        if delta < 0 or delta > 365:
            return None
        return d.isoformat()

    def _valid_time_window(s: Any) -> str:
        if isinstance(s, str) and s.strip().lower() in {"morning", "afternoon", "evening", "all"}:
            return s.strip().lower()
        return "all"

    def _valid_weekdays(v: Any) -> List[int]:
        if not isinstance(v, list):
            return []
        out: List[int] = []
        for x in v:
            try:
                n = int(x)
            except (TypeError, ValueError):
                continue
            if 0 <= n <= 6 and n not in out:
                out.append(n)
        return out

    return {
        "title": str(parsed.get("title", "")).strip()[:200] or "New Meeting",
        "durationMinutes": _clamp(parsed.get("durationMinutes"), 15, 480, 60),
        "daysForward": _clamp(parsed.get("daysForward"), 1, 90, 7),
        "dateRangeStart": _valid_future_date(parsed.get("dateRangeStart")),
        "timeWindow": _valid_time_window(parsed.get("timeWindow")),
        "excludedWeekdays": _valid_weekdays(parsed.get("excludedWeekdays")),
        "description": str(parsed.get("description", "")).strip()[:2000],
        "participantHints": [str(h).strip() for h in (parsed.get("participantHints") or []) if h],
    }


# ---------------------------------------------------------------------------
# Participant context builder (now with calendar events + history)
# ---------------------------------------------------------------------------

def build_participant_context(
    participant_states: List[dict],
    participant_profiles: List[dict],
    participant_busy: Optional[Dict[str, List[dict]]] = None,
) -> List[Dict[str, Any]]:
    """
    Compact participant summary for the AI prompt.

    participant_busy: optional dict of {userId: [{start, end}, ...]} from
    calendar lookups — gets redacted (no titles/attendees) before being sent.
    """
    by_id = {p.get("userId"): p for p in participant_profiles}
    busy = participant_busy or {}
    out = []
    for state in participant_states:
        uid = state.get("userId")
        profile = by_id.get(uid, {})
        metrics = state.get("meetingLoadMetrics", {}) or {}
        # Fairness trend: most recent N cancellation timestamps as a coarse trend signal
        trend = [str(t) for t in (metrics.get("cancellation_timestamps", []) or [])][-MAX_HISTORY_ENTRIES:]
        out.append({
            "userId": uid,
            "displayName": profile.get("displayName") or uid,
            "timezone": profile.get("timezone", "UTC"),
            "workingHours": profile.get("workingHours"),
            "workingDays": profile.get("workingDays"),
            "fairnessScore": state.get("fairnessScore"),
            "meetings_this_week": metrics.get("meetings_this_week", 0),
            "prime_slots_accepted": metrics.get("prime_slots_accepted", 0),
            "recent_cancellation_timestamps": trend,
            "calendar_density": _redact_events(busy.get(uid, [])),
        })
    return out
