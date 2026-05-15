"""
SFN State: CalculateFairnessScores

Input:  full payload from GenerateCandidateSlots
Output: adds scored_slots, optimization_needed

Scores each candidate using the Social Fairness Algorithm and determines
whether the Dynamic Reshuffling Engine needs to activate.
"""
from datetime import datetime

from src.common.timezone import get_tz_offset_hours
from src.core.fairness import engine


def handler(payload: dict) -> dict:
    profiles = payload.get("participant_profiles", [])
    participant_states = payload.get("participant_states", [])
    candidate_slots = payload.get("candidate_slots", [])
    duration_minutes = payload.get("duration_minutes", 60)
    tz_offset = float(payload.get("tz_offset_hours", 0.0))

    participant_tz_offsets = [get_tz_offset_hours(p.get("timezone", "UTC")) for p in profiles] or None
    participant_working_days = [p.get("workingDays", [0, 1, 2, 3, 4]) for p in profiles] or None
    participant_lunch_breaks = [p.get("lunchBreak") for p in profiles] or None

    scored = []
    for slot in candidate_slots:
        dt = datetime.fromisoformat(slot["startIso"])
        busy_count = int(slot.get("conflictCount", 0))
        result = engine.score_time_slot(
            dt, participant_states, duration_minutes,
            tz_offset_hours=tz_offset,
            participant_tz_offsets=participant_tz_offsets,
            participant_working_days=participant_working_days,
            participant_lunch_breaks=participant_lunch_breaks,
            busy_count=busy_count,
        )
        scored.append({**slot, **result})

    payload["scored_slots"] = scored
    payload["optimization_needed"] = engine.needs_optimization(scored)
    return payload
