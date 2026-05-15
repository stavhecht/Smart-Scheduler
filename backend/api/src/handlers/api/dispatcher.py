from __future__ import annotations

from fastapi import HTTPException

from src.handlers.api import calendar as _cal
from src.handlers.api import meetings as _mtg
from src.handlers.api import profile as _prf


def dispatch(action: str, identity: dict, data: str | None) -> dict:
    """Route an action string to the appropriate handler function."""

    EXACT: dict = {
        "profile":              lambda: _prf.handle_profile(identity),
        "update_profile":       lambda: _prf.handle_update_profile(identity, data),
        "get_messages":         lambda: _prf.handle_get_messages(identity),
        "mark_messages_read":   lambda: _prf.handle_mark_messages_read(identity),
        "meetings":             lambda: _mtg.handle_meetings(identity),
        "calendar_events":      lambda: _cal.handle_calendar_events(identity, data),
        "calendar_status":      lambda: _cal.handle_calendar_status(identity),
        "create_meeting":       lambda: _mtg.handle_create_meeting(identity, data),
        "score_slot":           lambda: _mtg.handle_score_slot(identity, data),
        "update_ics_url":       lambda: _cal.handle_ics_url(identity, data),
        "profile_stats":        lambda: _prf.handle_profile_stats(identity),
        "list_users":           lambda: _prf.handle_list_users(identity),
        "activity_feed":        lambda: _prf.handle_activity_feed(identity),
    }
    if action in EXACT:
        return EXACT[action]()

    PREFIX: list = [
        ("book:",               lambda: _mtg.handle_book(identity, action, data)),
        ("accept:",             lambda: _mtg.handle_accept(identity, action)),
        ("decline:",            lambda: _mtg.handle_decline(identity, action)),
        ("cancel:",             lambda: _mtg.handle_cancel(identity, action)),
        ("edit:",               lambda: _mtg.handle_edit(identity, action, data)),
        ("book_custom:",        lambda: _mtg.handle_book_custom(identity, action, data)),
        ("reschedule:",         lambda: _mtg.handle_reschedule(identity, action, data)),
        ("meeting_log:",        lambda: _mtg.handle_meeting_log(identity, action)),
        ("send_message:",       lambda: _prf.handle_send_message(identity, action, data)),
        ("get_public_profile:", lambda: _prf.handle_public_profile(identity, action)),
        ("shared_meetings:",    lambda: _prf.handle_shared_meetings(identity, action)),
        ("oauth_url:",          lambda: _cal.handle_oauth_url(identity, action)),
        ("oauth_callback:",     lambda: _cal.handle_oauth_callback(identity, action, data)),
        ("calendar_disconnect:", lambda: _cal.handle_disconnect(identity, action)),
    ]
    for prefix, fn in PREFIX:
        if action.startswith(prefix):
            return fn()

    raise HTTPException(status_code=400, detail=f"Unknown action: '{action}'")
