"""
SFN State: StoreResults

Persists the final ranked slots to DynamoDB.
Uses final_slots (post-reshuffle) if present, otherwise selects the best
from scored_slots.

Input:  payload with request_id, scored_slots, and optionally final_slots
Output: adds stored_slots_count
"""
from datetime import datetime

from src.database import models
from src.database.repository import MeetingRepository

_meeting_repo = MeetingRepository()


def handler(payload: dict) -> dict:
    request_id = payload["request_id"]
    scored_slots = payload.get("scored_slots", [])

    from src.core.fairness import engine
    best_slots = (
        payload["final_slots"]
        if "final_slots" in payload
        else engine.select_best_slots(scored_slots, count=8)
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
        )
        _meeting_repo.write_slot(
            request_id,
            slot.startIso.isoformat(),
            slot.model_dump(mode="json"),
        )

    payload["stored_slots_count"] = len(best_slots)
    return payload
