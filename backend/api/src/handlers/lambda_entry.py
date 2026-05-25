"""
SFN router — called by main.handler when the Lambda event contains sfn_action.
Each Step Functions state sends: {"sfn_action": "<action>", "payload": {<state>}}
"""
from src.handlers.workflow import (
    ai_fetch_context,
    ai_score_meeting,
    ai_store_score,
    calculate_fairness,
    fetch_participants,
    generate_slots,
    reshuffle_slots,
    store_results,
)

_ACTION_MAP = {
    # Sync workflow (slot generation)
    "fetch_participants":  fetch_participants.handler,
    "generate_slots":      generate_slots.handler,
    "calculate_fairness":  calculate_fairness.handler,
    "reshuffle_slots":     reshuffle_slots.handler,
    "store_results":       store_results.handler,
    # Async workflow (AI fairness scoring)
    "ai_fetch_context":    ai_fetch_context.handler,
    "ai_score_meeting":    ai_score_meeting.handler,
    "ai_store_score":      ai_store_score.handler,
    "ai_record_error":     ai_store_score.record_error,
}


def sfn_router(event: dict, context) -> dict:
    action = event.get("sfn_action")
    payload = event.get("payload", event)

    handler_fn = _ACTION_MAP.get(action)
    if not handler_fn:
        raise ValueError(f"Unknown sfn_action: '{action}'")

    return handler_fn(payload)
