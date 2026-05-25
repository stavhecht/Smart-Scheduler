"""
SFN State: StoreResults

Persists the final ranked slots to DynamoDB.
Uses final_slots (post-reshuffle) if present, otherwise selects the best
from scored_slots.

Input:  payload with request_id, scored_slots, and optionally final_slots
Output: adds stored_slots_count
"""
import logging
from datetime import datetime

from src.database import models
from src.database.repository import MeetingRepository

logger = logging.getLogger(__name__)
_meeting_repo = MeetingRepository()


def _persist_meeting_summary(request_id: str, ai_summary: dict) -> None:
    """Patch the meeting META row with AI strategic-summary fields."""
    if not ai_summary:
        return
    meta = _meeting_repo.get_meta(request_id)
    if not meta:
        return
    meta.update({
        "aiMeetingScore": float(ai_summary.get("meetingScore", 0.0)),
        "aiSummary": str(ai_summary.get("summary", ""))[:300],
        "aiBestSlotIso": str(ai_summary.get("bestSlotIso", "")),
        "aiBestSlotReason": str(ai_summary.get("bestSlotReason", ""))[:600],
        "aiCalendarSuggestions": list(ai_summary.get("calendarSuggestions", []))[:4],
    })
    _meeting_repo.update_meta(request_id, meta)


def handler(payload: dict) -> dict:
    request_id = payload["request_id"]
    scored_slots = payload.get("scored_slots", [])
    ai_summary = payload.get("ai_summary")

    from src.core.fairness import engine
    from datetime import datetime as _dt
    try:
        days_forward = max(1, (_dt.fromisoformat(payload["date_range_end"]) - _dt.fromisoformat(payload["date_range_start"])).days)
    except Exception:
        days_forward = 7
    slot_count = min(30, max(8, days_forward * 3))
    logger.info(f"store_results: scored={len(scored_slots)} days_forward={days_forward} slot_count={slot_count} has_final={'final_slots' in payload}")
    best_slots = (
        payload["final_slots"]
        if "final_slots" in payload
        else engine.select_best_slots(scored_slots, count=slot_count)
    )

    for slot_data in best_slots:
        slot = models.SuggestedTimeSlot(
            requestId=request_id,
            startIso=datetime.fromisoformat(slot_data["startIso"]),
            endIso=datetime.fromisoformat(slot_data["endIso"]),
            score=float(slot_data["score"]),
            fairnessImpact=float(slot_data["fairnessImpact"]),
            conflictCount=slot_data.get("conflictCount", 0),
            explanation=slot_data["explanation"],
            aiScored=bool(slot_data.get("aiScored", False)),
            aiSuggestions=slot_data.get("aiSuggestions"),
        )
        _meeting_repo.write_slot(
            request_id,
            slot.startIso.isoformat(),
            slot.model_dump(mode="json"),
        )

    if ai_summary:
        try:
            _persist_meeting_summary(request_id, ai_summary)
        except Exception as e:
            logger.warning(f"store_results: failed to persist AI summary: {e}")

    payload["stored_slots_count"] = len(best_slots)
    return payload
