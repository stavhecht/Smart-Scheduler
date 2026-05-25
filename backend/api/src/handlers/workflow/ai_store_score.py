"""
SFN State: AIStoreScore (async fairness workflow)

Input:  {request_id, ai_fairness_result, participants_context}
Output: passthrough

Persists:
  - MEET#<id> / AISCORE                 → latest AI verdict (frontend polls this)
  - MEET#<id> / AIHIST#<timestamp>      → audit trail per meeting (TTL: 90 days)
  - USER#<id> / AIFAIRHIST#<timestamp>  → per-user fairness trajectory (TTL: 365 days)
"""
from __future__ import annotations

import logging

from src.database.repository import AIFairnessRepository

logger = logging.getLogger(__name__)

_ai_repo = AIFairnessRepository()


def handler(payload: dict) -> dict:
    request_id = payload.get("request_id", "")
    result = payload.get("ai_fairness_result") or {}
    participants_context = payload.get("participants_context", []) or []

    if not request_id:
        logger.warning("[ai_store_score] missing request_id — skipping write")
        return payload

    _ai_repo.write_meeting_score(request_id, result)
    _ai_repo.append_meeting_history(request_id, result)

    meeting_score = float(result.get("meeting_fairness_score", 0.0))
    for participant in participants_context:
        uid = participant.get("userId", "")
        if uid:
            _ai_repo.append_user_fairness_point(uid, request_id, meeting_score)

    logger.info(f"[ai_store_score] request_id={request_id} stored score={meeting_score}")
    return payload


def record_error(payload: dict) -> dict:
    """Catch handler — invoked by SFN when a prior step errors out.

    Writes an error marker so the frontend poll surfaces a clear state instead
    of spinning forever.
    """
    request_id = payload.get("request_id", "")
    error = payload.get("Error", "unknown")
    cause = payload.get("Cause", "")
    if not request_id:
        return payload
    _ai_repo.write_meeting_score(request_id, {
        "method": "error",
        "model": "",
        "meeting_fairness_score": 0.0,
        "summary": f"AI fairness scoring failed: {error}",
        "slot_scores": [],
        "participant_equity": [],
        "error": str(cause)[:500],
    })
    logger.warning(f"[ai_store_score:record_error] request_id={request_id} error={error}")
    return payload
