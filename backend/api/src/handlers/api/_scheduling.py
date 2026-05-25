"""
Scheduling orchestration: tries Step Functions first, falls back to calling
the workflow step handlers in-process. Shared by handle_create_meeting and
handle_reschedule.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta

import boto3
from fastapi import HTTPException

from src.common.timezone import get_tz_offset_hours
from src.database import models
from src.database.repository import MeetingRepository, UserRepository

logger = logging.getLogger(__name__)

_sfn_client = None
_meeting_repo = MeetingRepository()
_user_repo = UserRepository()


def _get_sfn_client():
    global _sfn_client
    if _sfn_client is None:
        _sfn_client = boto3.client("stepfunctions")
    return _sfn_client


def _get_state_machine_arn() -> str:
    region = os.environ.get("AWS_REGION", "us-east-1")
    account_id = os.environ.get("AWS_ACCOUNT_ID", "")
    if not account_id:
        account_id = boto3.client("sts").get_caller_identity()["Account"]
    return f"arn:aws:states:{region}:{account_id}:stateMachine:SmartSchedulerWorkflow"


def _get_ai_state_machine_arn() -> str:
    region = os.environ.get("AWS_REGION", "us-east-1")
    account_id = os.environ.get("AWS_ACCOUNT_ID", "")
    if not account_id:
        account_id = boto3.client("sts").get_caller_identity()["Account"]
    return f"arn:aws:states:{region}:{account_id}:stateMachine:SmartSchedulerFairnessAI"


def _trigger_ai_fairness_async(meeting_dict: dict, sfn_input: dict) -> None:
    """
    Fire-and-forget: kick off the standard (async) SmartSchedulerFairnessAI
    workflow after the sync slot-generation pipeline returns. Never raises —
    the booking flow must not depend on AI scoring succeeding.
    """
    if os.environ.get("ENVIRONMENT") == "development":
        return
    try:
        sfn = _get_sfn_client()
        sfn.start_execution(
            stateMachineArn=_get_ai_state_machine_arn(),
            name=f"ai-{meeting_dict.get('requestId', 'unknown')}-{int(datetime.now().timestamp())}",
            input=json.dumps(sfn_input),
        )
    except Exception as exc:
        logger.warning(f"[ai_fairness] async trigger failed for {meeting_dict.get('requestId')}: {exc}")


def run_or_schedule(
    meeting_data: models.MeetingCreateSchema, user_id: str
) -> dict:
    """
    Creates the meeting record then either triggers Step Functions (AWS)
    or runs the scheduling pipeline in-process (local / fallback).
    """
    account_id = os.environ.get("AWS_ACCOUNT_ID", "")
    if not account_id or os.environ.get("ENVIRONMENT") == "development":
        from src.handlers.api._local_sim import run_simulation
        return run_simulation(meeting_data, user_id)

    meeting = _meeting_repo.create_record(meeting_data, user_id)
    creator_profile = _user_repo.get_profile_raw(user_id)
    creator_tz = (creator_profile or {}).get("timezone", "UTC")

    all_pids = list(set([user_id] + (meeting_data.participantIds or [])))
    participant_profiles_for_sfn = []
    for uid in all_pids:
        p = _user_repo.get_profile_raw(uid)
        if p:
            participant_profiles_for_sfn.append({
                "userId": uid,
                "timezone": p.get("timezone", "UTC"),
                "workingHours": p.get("workingHours", {"start": "09:00", "end": "18:00"}),
                "workingDays": p.get("workingDays", [0, 1, 2, 3, 4]),
                "lunchBreak": p.get("lunchBreak", {"start": "12:00", "duration": 60}),
            })

    sfn_input = {
        "request_id": meeting.requestId,
        "creator_id": user_id,
        "participant_ids": meeting_data.participantIds,
        "date_range_start": meeting.dateRangeStart.isoformat(),
        "date_range_end": meeting.dateRangeEnd.isoformat(),
        "duration_minutes": meeting.durationMinutes,
        "tz_offset_hours": get_tz_offset_hours(creator_tz),
        "participant_profiles": participant_profiles_for_sfn,
    }

    try:
        sfn = _get_sfn_client()
        resp = sfn.start_sync_execution(
            stateMachineArn=_get_state_machine_arn(),
            name=f"schedule-{meeting.requestId}",
            input=json.dumps(sfn_input),
        )
        if resp["status"] == "FAILED":
            raise Exception(resp.get("error", "Workflow failed"))
    except Exception as sfn_exc:
        logger.warning(f"SFN failed for {meeting.requestId}, falling back to local: {sfn_exc}")
        try:
            _run_local_steps(sfn_input)
        except Exception as local_exc:
            logger.warning(f"Local scheduling also failed for {meeting.requestId}: {local_exc}")

    meeting_dict = meeting.model_dump(mode="json")
    _trigger_ai_fairness_async(meeting_dict, sfn_input)
    return meeting_dict


def run_local_steps(payload: dict) -> None:
    """Calls the workflow step handlers sequentially (SFN fallback path)."""
    _run_local_steps(payload)


def _run_local_steps(payload: dict) -> None:
    from src.handlers.workflow import (
        calculate_fairness,
        fetch_participants,
        generate_slots,
        reshuffle_slots,
        store_results,
    )
    payload = fetch_participants.handler(payload)
    payload = generate_slots.handler(payload)
    payload = calculate_fairness.handler(payload)
    if payload.get("optimization_needed"):
        payload = reshuffle_slots.handler(payload)
    store_results.handler(payload)


def build_reschedule_payload(
    meeting: dict, user_id: str, request_id: str, days_forward: int
) -> dict:
    creator_profile = _user_repo.get_profile_raw(user_id)
    creator_tz = (creator_profile or {}).get("timezone", "UTC")
    now = datetime.now()
    return {
        "request_id": request_id,
        "creator_id": user_id,
        "participant_ids": meeting.get("participantUserIds", []),
        "date_range_start": now.isoformat(),
        "date_range_end": (now + timedelta(days=days_forward)).isoformat(),
        "duration_minutes": meeting.get("durationMinutes", 60),
        "tz_offset_hours": get_tz_offset_hours(creator_tz),
    }
