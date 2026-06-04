"""
Minimal OpenAI client — natural-language meeting parser only.

Uses stdlib urllib to avoid bundling the openai SDK in the Lambda zip.
AI fairness scoring lives in src/core/ai_fairness.py; this module only handles
the meeting-intent NL parser (used by handle_parse_meeting_nl) and exports a
couple of helpers (`_norm_iso`, `_redact_events`) that ai_fairness reuses.
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
MODEL = "gpt-4.1-nano"
REQUEST_TIMEOUT_SECONDS = 15.0
TEMPERATURE = 0.3
MAX_EVENTS_PER_PARTICIPANT = 25   # Default cap used by _redact_events


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

    system_prompt = (
        f"Convert a meeting request to JSON. Today is {today_iso}; resolve all relative dates against it.\n"
        "Output ONLY this JSON object:\n"
        '{"title": str, "durationMinutes": int 15-480, "daysForward": int 1-90, '
        '"dateRangeStart": "YYYY-MM-DD"|null, '
        '"timeWindow": "all"|"morning"|"afternoon"|"evening", '
        '"excludedWeekdays": [int 0-6, ...], '
        '"description": str, "participantHints": [str, ...]}\n\n'
        "Rules:\n"
        "- title: short topic headline (e.g. 'Sync with Sarah', 'Design review'). Required.\n"
        "- durationMinutes: 'quick'=15, 'sync'=30, 'meeting'=60, 'workshop'=120. Default 60.\n"
        "- dateRangeStart: REQUIRED whenever the request names a specific day. "
        "'today'→today; 'tomorrow'→today+1; 'next Monday'/'on Friday'/'June 15'→that specific date; "
        "'next week'→Monday of next week; 'in 2 weeks'→today+14. "
        "Only null when the request gives NO day anchor at all (e.g. 'set up a meeting', 'sometime this month').\n"
        "- daysForward: width of the search window in days from the anchor. "
        "Single named day ('tomorrow', 'on Friday')=1; 'this week'=5; 'next week'=7; 'in 2 weeks'=3; 'this month'=30; 'asap'=3. Default 7.\n"
        "- timeWindow: morning≈8–12, afternoon≈12–17, evening≈17–20. "
        "'early'/'before noon'→morning; 'after lunch'→afternoon; 'tonight'/'after work'/'late'→evening. Default 'all'.\n"
        "- excludedWeekdays: Mon=0..Sun=6. 'no weekends'→[5,6]; 'avoid Tuesdays'→[1]. "
        "Never exclude a day the user is requesting (e.g. 'on Friday' must NOT include 4). Default [].\n"
        "- description: 1-3 line agenda if the user gave one ('to discuss X', 'about Y'). Else empty.\n"
        "- participantHints: ONLY names/emails the user explicitly named in the request text. "
        "Resolve each to a contact's displayName or email when there is a match, otherwise return the literal mention. "
        "NEVER include anyone not named in the input — no inferring, no 'likely attendees'. "
        "The contacts list is a LOOKUP TABLE for resolving names that DO appear in the request — it is NOT a pool of attendees to draw from. "
        "If the request text contains no proper noun (capitalized name), no @ symbol, and no group reference ('the team', 'engineering'), return []. "
        "Verbs like 'meet', 'schedule', 'set up a meeting' do NOT imply attendees — only an explicit name does. "
        "Examples:\n"
        "  'schedule a meeting' → []\n"
        "  'set up a meeting tomorrow afternoon' → []\n"
        "  'schedule a design review next week' → []\n"
        "  'block off 90 min for focus work' → []\n"
        "  'meet with Sarah' → ['Sarah Johnson']  (when Sarah Johnson is in contacts)\n"
        "  'sync with the team' → ['the team']"
    )

    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
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
