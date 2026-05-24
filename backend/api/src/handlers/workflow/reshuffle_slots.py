"""
SFN State: ReshuffleSlots (Dynamic Reshuffling Engine)

Activated when the average slot score falls below the OPTIMIZATION_THRESHOLD.
Filters low-quality slots and re-selects the best available options.

Input:  payload with scored_slots
Output: adds final_slots
"""
from datetime import datetime
from src.core.fairness import engine


def handler(payload: dict) -> dict:
    try:
        days_forward = max(1, (datetime.fromisoformat(payload["date_range_end"]) - datetime.fromisoformat(payload["date_range_start"])).days)
    except Exception:
        days_forward = 7
    slot_count = min(30, max(8, days_forward * 3))
    payload["final_slots"] = engine.reshuffle(payload.get("scored_slots", []), count=slot_count)
    return payload
