"""
SFN State: CalculateFairnessScores

Scores each candidate slot AND produces a meeting-wide AI summary in one call.
AI-first: the deterministic engine score is always computed (it provides
`fairnessImpact` which booking math depends on), then AI score/explanation/
suggestions are overlaid on top. On any AI failure the engine output is kept.
"""
import logging
from datetime import datetime

from src.common import openai_client
from src.common.timezone import get_tz_offset_hours
from src.core.fairness import engine

logger = logging.getLogger(__name__)


def handler(payload: dict) -> dict:
    profiles = payload.get("participant_profiles", [])
    participant_states = payload.get("participant_states", [])
    candidate_slots = payload.get("candidate_slots", [])
    participant_busy = payload.get("participant_busy", {}) or {}
    duration_minutes = payload.get("duration_minutes", 60)
    tz_offset = float(payload.get("tz_offset_hours", 0.0))

    participant_tz_offsets = [get_tz_offset_hours(p.get("timezone", "UTC")) for p in profiles] or None
    participant_working_days = [p.get("workingDays", list(range(7))) for p in profiles] or None
    participant_lunch_breaks = [p.get("lunchBreak") for p in profiles] or None

    # 1. Engine baseline — always runs (cheap; provides fairnessImpact)
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
        scored.append({**slot, **result, "aiScored": False, "aiSuggestions": None})

    # 2. AI overlay — single call returns per-slot scores AND meeting summary
    ai_context_slots = [
        {
            "startIso": s["startIso"],
            "endIso": s["endIso"],
            "conflictCount": s.get("conflictCount", 0),
            "heuristic_baseline_score": s["score"],
        }
        for s in scored
    ]
    participants_summary = openai_client.build_participant_context(
        participant_states, profiles, participant_busy,
    )

    payload["ai_summary"] = None
    try:
        ai_result = openai_client.score_slots_with_ai(
            ai_context_slots, participants_summary, duration_minutes,
        )
        ai_slots = ai_result.get("slots", {})
        applied = 0
        for s in scored:
            ai = ai_slots.get(openai_client._norm_iso(s["startIso"]))
            if ai:
                s["score"] = ai["score"]
                s["explanation"] = ai["explanation"]
                s["aiSuggestions"] = ai["suggestions"]
                s["aiScored"] = True
                applied += 1
        if ai_result.get("meeting"):
            payload["ai_summary"] = ai_result["meeting"]
        logger.info(
            f"calculate_fairness: AI scored {applied}/{len(scored)} slots, "
            f"meeting summary={'yes' if payload['ai_summary'] else 'no'}"
        )
    except openai_client.OpenAIScoreError as e:
        logger.warning(f"calculate_fairness: AI scoring failed, using engine fallback ({e})")

    # Fill any empty explanations with heuristic fallback, then strip internal keys
    _internal = {"_hour", "_day", "_load_penalty", "_equity_bonus"}
    clean_scored = []
    for slot in scored:
        if not slot.get("explanation"):
            slot["explanation"] = engine.explain_slot(
                hour=int(slot.get("_hour", 10)),
                day=int(slot.get("_day", 0)),
                score=float(slot.get("score", 50)),
                load_penalty=float(slot.get("_load_penalty", 0.0)),
                equity_bonus=float(slot.get("_equity_bonus", 20.0)),
            )
        clean_scored.append({k: v for k, v in slot.items() if k not in _internal})

    payload["scored_slots"] = clean_scored
    payload["optimization_needed"] = engine.needs_optimization(clean_scored)
    return payload
