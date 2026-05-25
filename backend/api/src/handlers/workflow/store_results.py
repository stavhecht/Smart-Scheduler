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


def handler(payload: dict) -> dict:
    request_id = payload["request_id"]
    scored_slots = payload.get("scored_slots", [])

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
            startIso=datetime.fromisoformat(slot_data["startIso"].replace("Z", "+00:00")),
            endIso=datetime.fromisoformat(slot_data["endIso"].replace("Z", "+00:00")),
            score=float(slot_data["score"]),
            fairnessImpact=float(slot_data["fairnessImpact"]),
            conflictCount=slot_data.get("conflictCount", 0),
            explanation=slot_data["explanation"],
        )
        _meeting_repo.write_slot(
            request_id,
            slot.startIso.isoformat(),
            slot.model_dump(mode="json"),
        )

    payload["stored_slots_count"] = len(best_slots)
    return payload
