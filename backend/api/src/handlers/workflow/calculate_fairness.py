"""
SFN State: CalculateFairnessScores

Input:  full payload from GenerateCandidateSlots
Output: adds scored_slots, optimization_needed

Scores each candidate using the Social Fairness Algorithm, then re-ranks
the top candidates with GPT-4o-mini for real, context-aware explanations.
Falls back to heuristic order silently if the OpenAI call fails.
"""
import json
import logging
import os
from datetime import datetime

from src.common.timezone import get_tz_offset_hours
from src.core.fairness import engine

logger = logging.getLogger(__name__)


def _ai_rank_and_explain(candidates: list, participant_summaries: list) -> list:
    """
    Ask GPT-4o-mini to re-rank the top candidates and write 1-sentence explanations.
    Returns a list of {slot_index, rank, explanation} dicts, sorted best-first.
    Returns [] on any failure so the caller can fall back to heuristic order.
    """
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        return []

    try:
        import openai
        client = openai.OpenAI(api_key=api_key)

        slot_data = [
            {
                "index": i,
                "start": c["startIso"],
                "heuristic_score": c["score"],
                "conflict_count": c.get("conflictCount", 0),
                "fairness_impact": c.get("fairnessImpact", -1.0),
            }
            for i, c in enumerate(candidates)
        ]

        prompt = (
            "You are a smart meeting scheduling assistant. "
            "Given participant context and candidate meeting slots (with heuristic scores 0-100), "
            "rank the slots from best to worst and write a concise 1-sentence explanation for each "
            "that explains WHY it is good or bad for this specific group.\n\n"
            f"Participants:\n{json.dumps(participant_summaries, indent=2)}\n\n"
            f"Candidate slots:\n{json.dumps(slot_data, indent=2)}\n\n"
            "Return ONLY a JSON array sorted best-first:\n"
            '[{"slot_index": 0, "rank": 1, "explanation": "..."}]\n'
            "No other text."
        )

        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=900,
        )
        raw = resp.choices[0].message.content.strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw)
    except Exception as exc:
        logger.warning(f"[calculate_fairness] OpenAI call failed, using heuristic order: {exc}")
        return []


def handler(payload: dict) -> dict:
    profiles = payload.get("participant_profiles", [])
    participant_states = payload.get("participant_states", [])
    candidate_slots = payload.get("candidate_slots", [])
    duration_minutes = payload.get("duration_minutes", 60)
    tz_offset = float(payload.get("tz_offset_hours", 0.0))

    participant_tz_offsets = [get_tz_offset_hours(p.get("timezone", "UTC")) for p in profiles] or None
    participant_working_days = [p.get("workingDays", list(range(7))) for p in profiles] or None
    participant_lunch_breaks = [p.get("lunchBreak") for p in profiles] or None

    # Step 1: heuristic scoring for all candidates
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

    # Step 2: AI re-ranking for top 15 candidates
    sorted_by_heuristic = sorted(scored, key=lambda s: s["score"], reverse=True)
    top_candidates = sorted_by_heuristic[:15]

    participant_summaries = [
        {
            "name": p.get("displayName") or p.get("name") or p.get("userId", "unknown"),
            "fairness_score": round(
                engine.calculate_user_score(
                    p.get("meetingLoadMetrics", {}),
                    p.get("lastUpdatedAt"),
                ),
                1,
            ),
            "meetings_this_week": p.get("meetingLoadMetrics", {}).get("meetings_this_week", 0),
            "timezone": p.get("timezone", "UTC"),
            "working_hours": f"{min(p.get('workingHours', [9]))or 9}:00–{max(p.get('workingHours', [17])) or 17}:00",
            "calendar_connected": bool(p.get("googleCalendarConnected") or p.get("calendarConnected")),
        }
        for p in profiles
    ]

    ai_ranking = _ai_rank_and_explain(top_candidates, participant_summaries)

    if ai_ranking:
        # Build index → AI result map
        ai_map = {item["slot_index"]: item for item in ai_ranking}
        # Apply AI explanations
        for i, slot in enumerate(top_candidates):
            if i in ai_map:
                slot["explanation"] = ai_map[i].get("explanation", "")
        # Sort top candidates by AI rank (lower rank number = better)
        ranked = [(ai_map.get(i, {}).get("rank", 999), slot) for i, slot in enumerate(top_candidates)]
        ranked.sort(key=lambda x: x[0])
        top_candidates = [slot for _, slot in ranked]

        # Merge: AI-ranked top candidates + remaining heuristic-ordered tail
        top_ids = {id(s) for s in top_candidates}
        tail = [s for s in sorted_by_heuristic if id(s) not in top_ids]
        scored = top_candidates + tail
    else:
        scored = sorted_by_heuristic

    payload["scored_slots"] = scored
    payload["optimization_needed"] = engine.needs_optimization(scored)
    return payload
