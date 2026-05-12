from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from src.common import calendar_client
from fastapi import HTTPException

from src.database.repository import CalendarRepository, UserRepository

logger = logging.getLogger(__name__)

_cal_repo = CalendarRepository()
_user_repo = UserRepository()


def handle_calendar_events(identity: dict, data: str | None) -> list:
    try:
        params = json.loads(data) if data else {}
        time_min = params.get("timeMin", "")
        time_max = params.get("timeMax", "")
        if not time_min or not time_max:
            return []
        return calendar_client.get_google_events(identity["user_id"], time_min, time_max)
    except Exception as exc:
        logger.warning(f"[calendar_events] {exc}")
        return []


def handle_calendar_status(identity: dict) -> dict:
    try:
        result = _cal_repo.get_connected_calendars(identity["user_id"])
        ics_url = _cal_repo.get_ics_url(identity["user_id"])
        result["ics"] = {"connected": bool(ics_url), "url": ics_url}
        return result
    except Exception as exc:
        logger.warning(f"[calendar_status] {exc}")
        return {
            "google": {"connected": False, "email": ""},
            "microsoft": {"connected": False, "email": ""},
            "ics": {"connected": False, "url": ""},
        }


def handle_oauth_url(identity: dict, action: str) -> dict:
    provider = action.split(":", 1)[1]
    if provider == "google":
        if not calendar_client.GOOGLE_CLIENT_ID:
            raise HTTPException(
                status_code=503,
                detail="Google Calendar not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Lambda environment.",
            )
        return {"url": calendar_client.get_google_auth_url(identity["user_id"]), "provider": "google"}
    if provider == "microsoft":
        if not calendar_client.MS_CLIENT_ID:
            raise HTTPException(
                status_code=503,
                detail="Microsoft Calendar not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in Lambda environment.",
            )
        return {"url": calendar_client.get_microsoft_auth_url(identity["user_id"]), "provider": "microsoft"}
    raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")


def handle_oauth_callback(identity: dict, action: str, data: str | None) -> dict:
    provider = action.split(":", 1)[1]
    if not data:
        raise HTTPException(status_code=400, detail="Missing callback data")
    try:
        cb = json.loads(data)
        code = cb.get("code", "")
        raw_state = cb.get("state", "")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid callback data: {exc}")

    if not code:
        raise HTTPException(status_code=400, detail="Missing OAuth code")

    state_parts = raw_state.split(":", 2)
    user_id = identity["user_id"]
    if len(state_parts) != 3 or state_parts[0] != provider or state_parts[1] != user_id:
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    nonce = state_parts[2]
    validated_provider = _cal_repo.validate_and_consume_oauth_state(user_id, nonce)
    if not validated_provider:
        raise HTTPException(status_code=400, detail="Invalid or expired state. Please try connecting again.")

    if provider == "google":
        try:
            tokens = calendar_client.exchange_google_code(code)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Token exchange failed: {exc}")
        calendar_email = calendar_client.get_google_user_email(tokens.get("access_token", ""))
        expires_at = datetime.utcnow() + timedelta(seconds=tokens.get("expires_in", 3600))
        _cal_repo.save_oauth_tokens(user_id, "google", {
            "access_token": tokens.get("access_token", ""),
            "refresh_token": tokens.get("refresh_token", ""),
            "expires_at": expires_at.isoformat(),
            "scope": tokens.get("scope", ""),
            "calendar_email": calendar_email,
        })
        return {"status": "success", "provider": "google", "email": calendar_email}

    if provider == "microsoft":
        try:
            tokens = calendar_client.exchange_microsoft_code(code)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Token exchange failed: {exc}")
        calendar_email = calendar_client.get_microsoft_user_email(tokens.get("access_token", ""))
        expires_at = datetime.utcnow() + timedelta(seconds=tokens.get("expires_in", 3600))
        _cal_repo.save_oauth_tokens(user_id, "microsoft", {
            "access_token": tokens.get("access_token", ""),
            "refresh_token": tokens.get("refresh_token", ""),
            "expires_at": expires_at.isoformat(),
            "scope": tokens.get("scope", ""),
            "calendar_email": calendar_email,
        })
        return {"status": "success", "provider": "microsoft", "email": calendar_email}

    raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")


def handle_ics_url(identity: dict, data: str | None) -> dict:
    if not data:
        raise HTTPException(status_code=400, detail="Missing data")
    try:
        payload = json.loads(data)
        ics_url = payload.get("icsUrl", "").strip()
        _cal_repo.save_ics_url(identity["user_id"], ics_url)
        return {"status": "success"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


def handle_disconnect(identity: dict, action: str) -> dict:
    provider = action.split(":", 1)[1]
    _cal_repo.delete_oauth_tokens(identity["user_id"], provider)
    return {"status": "success", "provider": provider, "connected": False}
