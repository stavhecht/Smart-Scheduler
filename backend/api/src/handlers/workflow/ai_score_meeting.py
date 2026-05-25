"""
SFN State: AIScoreMeeting (async fairness workflow)

Input:  {request_id, scored_slots, participants_context}
Output: adds ai_fairness_result (full AI verdict + blended scores)

Invokes the OpenAI gpt-4o-mini agent in src.core.ai_fairness.
Falls back to heuristic-only if the API key is missing or the call errors.
"""
from __future__ import annotations

import logging

from src.core.ai_fairness import score_meeting_with_ai

logger = logging.getLogger(__name__)


def handler(payload: dict) -> dict:
    request_id = payload.get("request_id", "")
    scored_slots = payload.get("scored_slots", []) or []
    # Prefer the post-reshuffle slots if the sync workflow produced them
    final_slots = payload.get("final_slots") or scored_slots
    participants_context = payload.get("participants_context", []) or []

    if not final_slots:
        logger.warning(f"[ai_score_meeting] request_id={request_id} no slots to score")
        payload["ai_fairness_result"] = {
            "method": "skipped",
            "reason": "no_slots",
            "meeting_fairness_score": 0.0,
            "slot_scores": [],
        }
        return payload

    result = score_meeting_with_ai(request_id, final_slots, participants_context)
    payload["ai_fairness_result"] = result
    logger.info(
        f"[ai_score_meeting] request_id={request_id} method={result.get('method')} "
        f"meeting_score={result.get('meeting_fairness_score')}"
    )
    return payload
