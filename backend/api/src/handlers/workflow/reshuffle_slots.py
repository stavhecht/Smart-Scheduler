"""
SFN State: ReshuffleSlots (Dynamic Reshuffling Engine)

Activated when the average slot score falls below the OPTIMIZATION_THRESHOLD.
Filters low-quality slots and re-selects the best available options.

Input:  payload with scored_slots
Output: adds final_slots
"""
from src.core.fairness import engine


def handler(payload: dict) -> dict:
    payload["final_slots"] = engine.reshuffle(payload.get("scored_slots", []))
    return payload
