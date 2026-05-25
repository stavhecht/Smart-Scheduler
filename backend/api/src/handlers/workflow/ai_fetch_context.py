"""
SFN State: AIFetchContext (async fairness workflow)

Input:  {request_id, creator_id, participant_ids, date_range_start,
         date_range_end, scored_slots}
Output: adds participants_context (history + calendar events per user)

Pulls per-participant data the AI agent needs:
  - Historical fairness scores + recent trend
  - Current load metrics
  - Google Calendar events in the meeting horizon
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import List

from src.common import calendar_client
from src.database.repository import AIFairnessRepository, UserRepository

logger = logging.getLogger(__name__)

_user_repo = UserRepository()
_ai_repo = AIFairnessRepository()


def _fetch_user_calendar(user_id: str, date_start: datetime, date_end: datetime) -> List[dict]:
    """Best-effort Google Calendar fetch. Returns [] on any failure."""
    try:
        return calendar_client.get_user_busy_slots(user_id, date_start, date_end)
    except Exception as exc:
        logger.warning(f"[ai_fetch_context] calendar fetch failed for {user_id}: {exc}")
        return []


def handler(payload: dict) -> dict:
    request_id = payload.get("request_id", "")
    creator_id = payload.get("creator_id", "")
    participant_ids = payload.get("participant_ids", []) or []
    all_ids = list({creator_id, *participant_ids} - {""})

    try:
        date_start = datetime.fromisoformat(payload.get("date_range_start", ""))
        date_end = datetime.fromisoformat(payload.get("date_range_end", ""))
    except Exception:
        date_start = datetime.utcnow()
        date_end = datetime.utcnow()

    participants_context = []
    for uid in all_ids:
        profile = _user_repo.get_profile_raw(uid) or {}
        fairness = _user_repo.get_fairness(uid)
        load_metrics = fairness.meetingLoadMetrics if fairness else {}
        current_score = float(fairness.fairnessScore) if fairness else 100.0

        trend = _ai_repo.get_recent_fairness_trend(uid, limit=20)
        calendar_events = _fetch_user_calendar(uid, date_start, date_end)

        participants_context.append({
            "userId": uid,
            "timezone": profile.get("timezone", "UTC"),
            "current_fairness_score": current_score,
            "meetings_this_week": int(float(load_metrics.get("meetings_this_week", 0) or 0)),
            "suffering_score": int(float(load_metrics.get("suffering_score", 0) or 0)),
            "fairness_trend": trend,
            "calendar_events": calendar_events,
        })

    payload["participants_context"] = participants_context
    logger.info(
        f"[ai_fetch_context] request_id={request_id} participants={len(participants_context)} "
        f"avg_events={sum(len(p['calendar_events']) for p in participants_context) / max(1, len(participants_context)):.1f}"
    )
    return payload
