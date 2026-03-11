import json
import os
from typing import Optional
from urllib.parse import unquote

import boto3
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

import db
import calendar_client
import models

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Step Functions client (lazy-initialized)
# ---------------------------------------------------------------------------

_sfn_client = None

def get_sfn_client():
    global _sfn_client
    if _sfn_client is None:
        _sfn_client = boto3.client('stepfunctions')
    return _sfn_client


def get_state_machine_arn() -> str:
    """
    Construct the State Machine ARN from environment variables.
    This avoids a Terraform circular dependency between Lambda and Step Functions.
    """
    region = os.environ.get('AWS_REGION', 'us-east-1')
    account_id = os.environ.get('AWS_ACCOUNT_ID', '')
    if not account_id:
        # Fallback: fetch from STS (cached after first call)
        account_id = boto3.client('sts').get_caller_identity()['Account']
    return f"arn:aws:states:{region}:{account_id}:stateMachine:SmartSchedulerWorkflow"


# ---------------------------------------------------------------------------
# Step Functions workflow dispatcher
# (Called when Lambda is invoked directly by Step Functions, not API Gateway)
# ---------------------------------------------------------------------------

def sfn_router(event: dict, context) -> dict:
    """
    Routes Step Functions state machine invocations to the correct handler.
    Each SFN state sends: {"sfn_action": "<action>", "payload": {<full state>}}
    """
    action = event.get('sfn_action')
    payload = event.get('payload', event)  # Support both wrapped and direct payloads

    action_map = {
        'fetch_participants': db.sfn_fetch_participants,
        'generate_slots':    db.sfn_generate_slots,
        'calculate_fairness': db.sfn_calculate_fairness,
        'reshuffle_slots':   db.sfn_reshuffle_slots,
        'store_results':     db.sfn_store_results,
    }

    handler_fn = action_map.get(action)
    if not handler_fn:
        raise ValueError(f"Unknown sfn_action: '{action}'")

    return handler_fn(payload)


# ---------------------------------------------------------------------------
# Cognito token validation (no IAM required – uses user-facing GetUser API)
# ---------------------------------------------------------------------------

_cognito_client = None

def _get_cognito():
    global _cognito_client
    if _cognito_client is None:
        _cognito_client = boto3.client('cognito-idp', region_name='us-east-1')
    return _cognito_client


def validate_access_token(access_token: str) -> Optional[dict]:
    """
    Validates a Cognito *access* token by calling GetUser.
    This does NOT require any IAM permissions – Cognito authenticates the call
    using the token itself.  Returns identity dict on success, None on failure.
    """
    try:
        resp = _get_cognito().get_user(AccessToken=access_token)
        attrs = {a['Name']: a['Value'] for a in resp['UserAttributes']}
        user_id = attrs.get('sub', '')
        email   = attrs.get('email', '')
        name    = attrs.get('name') or email.split('@')[0]
        return {"user_id": user_id, "email": email, "display_name": name}
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Lambda entry point
# Dispatches between: API Gateway (via Mangum) and Step Functions
# ---------------------------------------------------------------------------

_mangum = Mangum(app)


def handler(event, context):
    # Step Functions invocations have 'sfn_action' key
    if 'sfn_action' in event:
        return sfn_router(event, context)
    # Everything else is an API Gateway HTTP request
    return _mangum(event, context)


# ---------------------------------------------------------------------------
# Identity helpers
# ---------------------------------------------------------------------------

def get_current_user(request: Request) -> dict:
    """
    Extracts the authenticated user's identity from the Cognito JWT claims.
    API Gateway v2 injects claims into event.requestContext.authorizer.jwt.claims.
    Falls back to a local dev default when no JWT is present.
    """
    event = request.scope.get("aws.event", {})
    try:
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        user_id = claims.get("sub", "anonymous")
        email = claims.get("email", f"{user_id}@example.com")
        display_name = claims.get("name") or claims.get("cognito:username") or email.split("@")[0]
        return {"user_id": user_id, "email": email, "display_name": display_name}
    except (KeyError, TypeError):
        return {"user_id": "u1", "email": "dev@localhost", "display_name": "Dev User"}


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health(action: Optional[str] = None, token: Optional[str] = None, data: Optional[str] = None):
    """
    Public route (no JWT authorizer on API Gateway).
    Without query params → simple health check.
    With action + token → CORS-safe proxy that validates the Cognito access
    token and dispatches to the correct handler.  Used by the React frontend
    to avoid CORS pre-flight failures caused by the JWT authorizer on the
    ANY /{proxy+} route returning 401 on OPTIONS requests.
    """
    if not action or not token:
        return {"status": "ok", "db": "DynamoDB Active", "sfn": "SmartSchedulerWorkflow"}

    try:
        # ── Auth ──────────────────────────────────────────────────────────
        identity = validate_access_token(token)
        if not identity:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        user_id      = identity["user_id"]
        email        = identity["email"]
        display_name = identity["display_name"]

        # ── profile ───────────────────────────────────────────────────────
        if action == "profile":
            try:
                db.ensure_user_profile(user_id, email, display_name)
                profile  = db.get_profile(user_id)
                fairness = db.get_fairness_state(user_id)
                if not profile:
                    raise HTTPException(status_code=404, detail="User not found")
                metrics = fairness.meetingLoadMetrics if fairness else {}
                return {
                    "id":             user_id,
                    "name":           profile.displayName,
                    "email":          profile.email,
                    "role":           "Cloud Architect",
                    "fairness_score": float(fairness.fairnessScore) if fairness else 100.0,
                    "details": {
                        "meetings_this_week":      metrics.get("meetings_this_week", 0),
                        "cancellations_last_month": metrics.get("cancellations_last_month", 0),
                        "suffering_score":         metrics.get("suffering_score", 0),
                    },
                }
            except HTTPException:
                raise
            except Exception as exc:
                # Fail soft in production: log and return minimal profile so UI can load
                print(f"[health] profile action failed for user {user_id}: {exc}")
                return {
                    "id": user_id,
                    "name": display_name,
                    "email": email,
                    "role": "Cloud Architect",
                    "fairness_score": 100.0,
                    "details": {
                        "meetings_this_week": 0,
                        "cancellations_last_month": 0,
                        "suffering_score": 0,
                    },
                }

        # ── meetings ──────────────────────────────────────────────────────
        if action == "meetings":
            try:
                meetings = db.get_user_meetings(user_id)
                result = []
                all_participant_ids: set = set()
                for m in meetings:
                    for pid in m.participantUserIds:
                        all_participant_ids.add(pid)
                name_map = db.get_users_by_ids(list(all_participant_ids))
                for m in meetings:
                    slots = db.get_meeting_slots(m.requestId)
                    d = m.model_dump(mode="json")
                    d['slots']            = [s.model_dump(mode="json") for s in slots]
                    d['userRole']         = 'organizer' if m.creatorUserId == user_id else 'participant'
                    d['participantNames'] = {pid: name_map.get(pid, {"name": pid, "email": ""})
                                             for pid in m.participantUserIds}
                    result.append(d)
                return result
            except Exception as exc:
                # If something goes wrong (e.g. bad legacy data), log and return empty list
                print(f"[health] meetings action failed for user {user_id}: {exc}")
                return []

        # ── calendar_status ───────────────────────────────────────────────
        if action == "calendar_status":
            try:
                return db.get_connected_calendars(user_id)
            except Exception as exc:
                print(f"[health] calendar_status failed for user {user_id}: {exc}")
                return {"google": {"connected": False, "email": ""}, "microsoft": {"connected": False, "email": ""}}

    except HTTPException:
        # preserve intended HTTP errors such as 401
        raise
    except Exception as exc:
        # Global safety net so frontend won't see 500s
        print(f"[health] unexpected error at action={action}: {exc}")
        return {"status": "error", "action": action, "message": "Internal error, please try again"}

    # ── create_meeting ────────────────────────────────────────────────────
    if action == "create_meeting":
        if not data:
            raise HTTPException(status_code=400, detail="Missing data for create_meeting")
        try:
            meeting_data = models.MeetingCreateSchema(**json.loads(data))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid meeting data: {exc}")

        # Resolve participant emails → IDs
        if meeting_data.participantEmails:
            found = db.get_users_by_emails(meeting_data.participantEmails)
            ids = list(meeting_data.participantIds)
            for u in found:
                uid = u.get('userId', '')
                if uid and uid not in ids and uid != user_id:
                    ids.append(uid)
            meeting_data.participantIds = ids

        account_id = os.environ.get('AWS_ACCOUNT_ID', '')
        if account_id:
            meeting = db.create_meeting_record(meeting_data, user_id)
            sfn_input = {
                "request_id":       meeting.requestId,
                "creator_id":       user_id,
                "participant_ids":  meeting_data.participantIds,
                "date_range_start": meeting.dateRangeStart.isoformat(),
                "date_range_end":   meeting.dateRangeEnd.isoformat(),
                "duration_minutes": meeting.durationMinutes,
            }
            try:
                sfn  = get_sfn_client()
                resp = sfn.start_sync_execution(
                    stateMachineArn=get_state_machine_arn(),
                    name=f"schedule-{meeting.requestId}",
                    input=json.dumps(sfn_input),
                )
                if resp['status'] == 'FAILED':
                    raise Exception(resp.get('error', 'Workflow failed'))
            except Exception:
                _run_local_scheduling(meeting_data, user_id, meeting.requestId)
            return meeting.model_dump(mode="json")
        else:
            return db.create_meeting_with_simulation(meeting_data, user_id)

    # ── book:<request_id>:<slot_start_iso> ────────────────────────────────
    if action.startswith("book:"):
        parts = action.split(":", 2)
        if len(parts) < 3:
            raise HTTPException(status_code=400, detail="Invalid book action (expected book:<id>:<slot>)")
        request_id, slot_start_iso = parts[1], unquote(parts[2])
        meeting = db._get_item(f"MEET#{request_id}", "META")
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        slot_data      = db._get_item(f"MEET#{request_id}", f"SLOT#{slot_start_iso}")
        fairness_impact = float(slot_data.get('fairnessImpact', -2.0)) if slot_data else -2.0
        db.update_fairness_on_booking(user_id, fairness_impact)
        meeting['status']            = 'confirmed'
        meeting['selectedSlotStart'] = slot_start_iso
        db._put_item(f"MEET#{request_id}", "META", meeting)
        db.log_meeting_activity(request_id, 'booked', user_id)
        # Best-effort: write to connected calendars and store event IDs for later deletion
        try:
            end_slot = slot_data.get('endIso', '') if slot_data else ''
            event_ids = calendar_client.write_meeting_to_calendars(
                creator_id=meeting.get('creatorUserId', ''),
                participant_ids=meeting.get('participantUserIds', []),
                title=meeting.get('title', 'Meeting'),
                start_iso=slot_start_iso,
                end_iso=end_slot,
            )
            if event_ids:
                meeting['externalEventIds'] = event_ids
                db._put_item(f"MEET#{request_id}", "META", meeting)
        except Exception:
            pass
        return {"status": "success", "message": "Meeting confirmed successfully", "meeting": meeting}

    # ── accept:<request_id> ───────────────────────────────────────────────
    if action.startswith("accept:"):
        request_id  = action.split(":", 1)[1]
        meeting     = db._get_item(f"MEET#{request_id}", "META")
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        participants = meeting.get('participantUserIds', [])
        if user_id not in participants:
            raise HTTPException(status_code=403, detail="You are not a participant in this meeting")
        accepted = meeting.get('acceptedBy', [])
        if user_id not in accepted:
            accepted.append(user_id)
        meeting['acceptedBy'] = accepted
        db._put_item(f"MEET#{request_id}", "META", meeting)
        db.log_meeting_activity(request_id, 'accepted', user_id)
        return {"status": "success", "message": "Meeting accepted", "acceptedBy": accepted}

    # ── cancel:<request_id> ───────────────────────────────────────────────
    if action.startswith("cancel:"):
        request_id = action.split(":", 1)[1]
        meeting    = db._get_item(f"MEET#{request_id}", "META")
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        if meeting.get('creatorUserId') != user_id:
            raise HTTPException(status_code=403, detail="Only the organizer can cancel a meeting")
        
        # Best-effort: remove from calendars before marking as cancelled
        external_ids = meeting.get('externalEventIds')
        if external_ids:
            calendar_client.remove_meeting_from_calendars(external_ids)

        updated = db.cancel_meeting(request_id, user_id)
        return {"status": "success", "message": "Meeting cancelled", "meeting": updated}

    # ── edit:<request_id> ─────────────────────────────────────────────────
    if action.startswith("edit:"):
        request_id = action.split(":", 1)[1]
        if not data:
            raise HTTPException(status_code=400, detail="Missing data for edit")
        try:
            payload = models.MeetingEditSchema(**json.loads(data))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid edit data: {exc}")
        meeting = db._get_item(f"MEET#{request_id}", "META")
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        if meeting.get('creatorUserId') != user_id:
            raise HTTPException(status_code=403, detail="Only the organizer can edit a meeting")
        if meeting.get('status') == 'cancelled':
            raise HTTPException(status_code=400, detail="Cannot edit a cancelled meeting")
        updated = db.edit_meeting(request_id, user_id,
                                  title=payload.title,
                                  duration_minutes=payload.durationMinutes)
        return {"status": "success", "meeting": updated}

    # ── reschedule:<request_id> ───────────────────────────────────────────
    if action.startswith("reschedule:"):
        request_id = action.split(":", 1)[1]
        days_forward = 7
        if data:
            try:
                days_forward = int(json.loads(data).get('daysForward', 7))
            except Exception:
                pass
        meeting = db._get_item(f"MEET#{request_id}", "META")
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        if meeting.get('creatorUserId') != user_id:
            raise HTTPException(status_code=403, detail="Only the organizer can reschedule")
        if meeting.get('status') == 'cancelled':
            raise HTTPException(status_code=400, detail="Cannot reschedule a cancelled meeting")
        # Reset meeting to pending and update timeframe
        from datetime import datetime, timedelta
        now = datetime.now()
        meeting['status']            = 'pending'
        meeting['selectedSlotStart'] = None
        meeting['acceptedBy']        = []
        meeting['dateRangeStart']    = now.isoformat()
        meeting['dateRangeEnd']      = (now + timedelta(days=days_forward)).isoformat()
        meeting['updatedAt']         = now.isoformat()

        # Best-effort: remove old events from calendars if already confirmed
        external_ids = meeting.get('externalEventIds', {})
        if external_ids:
            calendar_client.remove_meeting_from_calendars(external_ids)
            meeting['externalEventIds'] = {}

        db._put_item(f"MEET#{request_id}", "META", meeting)
        # Delete old slots
        db.delete_meeting_slots(request_id)
        # Regenerate slots (reuse globally imported MeetingCreateSchema)
        mock_schema = models.MeetingCreateSchema(
            title=meeting['title'],
            durationMinutes=meeting['durationMinutes'],
            participantIds=meeting.get('participantUserIds', []),
            daysForward=days_forward,
        )
        _run_local_scheduling(mock_schema, user_id, request_id)
        db.log_meeting_activity(request_id, 'rescheduled', user_id, {'daysForward': days_forward})
        return {"status": "success", "message": "Meeting rescheduled — new slots generated"}

    # ── meeting_log:<request_id> ──────────────────────────────────────────
    if action.startswith("meeting_log:"):
        request_id = action.split(":", 1)[1]
        meeting    = db._get_item(f"MEET#{request_id}", "META")
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        # Check access: creator or participant
        pids = meeting.get('participantUserIds', [])
        if meeting.get('creatorUserId') != user_id and user_id not in pids:
            raise HTTPException(status_code=403, detail="Access denied")
        logs = db.get_meeting_activity_log(request_id)
        return logs

    # ── calendar_status ───────────────────────────────────────────────────
    if action == "calendar_status":
        return db.get_connected_calendars(user_id)

    # ── oauth_url:google | oauth_url:microsoft ────────────────────────────
    if action.startswith("oauth_url:"):
        provider = action.split(":", 1)[1]
        if provider == "google":
            if not calendar_client.GOOGLE_CLIENT_ID:
                raise HTTPException(status_code=503,
                    detail="Google Calendar not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Lambda environment.")
            url = calendar_client.get_google_auth_url(user_id)
            return {"url": url, "provider": "google"}
        elif provider == "microsoft":
            if not calendar_client.MS_CLIENT_ID:
                raise HTTPException(status_code=503,
                    detail="Microsoft Calendar not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in Lambda environment.")
            url = calendar_client.get_microsoft_auth_url(user_id)
            return {"url": url, "provider": "microsoft"}
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    # ── oauth_callback:google | oauth_callback:microsoft ──────────────────
    if action.startswith("oauth_callback:"):
        provider = action.split(":", 1)[1]
        if not data:
            raise HTTPException(status_code=400, detail="Missing callback data")
        try:
            cb = json.loads(data)
            code      = cb.get('code', '')
            raw_state = cb.get('state', '')   # "provider:userId:nonce"
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid callback data: {exc}")

        if not code:
            raise HTTPException(status_code=400, detail="Missing OAuth code")

        # Parse and validate state nonce
        state_parts = raw_state.split(':', 2)
        if len(state_parts) != 3 or state_parts[0] != provider or state_parts[1] != user_id:
            raise HTTPException(status_code=400, detail="Invalid state parameter")
        nonce = state_parts[2]
        validated_provider = db.validate_and_consume_oauth_state(user_id, nonce)
        if not validated_provider:
            raise HTTPException(status_code=400, detail="Invalid or expired state. Please try connecting again.")

        if provider == "google":
            try:
                tokens = calendar_client.exchange_google_code(code)
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Token exchange failed: {exc}")
            calendar_email = calendar_client.get_google_user_email(tokens.get('access_token', ''))
            from datetime import datetime, timedelta
            expires_at = datetime.now() + timedelta(seconds=tokens.get('expires_in', 3600))
            db.save_oauth_tokens(user_id, 'google', {
                'access_token':   tokens.get('access_token', ''),
                'refresh_token':  tokens.get('refresh_token', ''),
                'expires_at':     expires_at.isoformat(),
                'scope':          tokens.get('scope', ''),
                'calendar_email': calendar_email,
            })
            return {"status": "success", "provider": "google", "email": calendar_email}

        elif provider == "microsoft":
            try:
                tokens = calendar_client.exchange_microsoft_code(code)
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Token exchange failed: {exc}")
            # Decode the id_token to get email (it's a JWT — parse the payload)
            calendar_email = ""
            try:
                import base64
                id_token = tokens.get('id_token', '')
                payload  = id_token.split('.')[1]
                payload += '=' * (4 - len(payload) % 4)   # fix padding
                claims   = json.loads(base64.b64decode(payload))
                calendar_email = claims.get('email') or claims.get('preferred_username', '')
            except Exception:
                pass
            from datetime import datetime, timedelta
            expires_at = datetime.now() + timedelta(seconds=tokens.get('expires_in', 3600))
            db.save_oauth_tokens(user_id, 'microsoft', {
                'access_token':   tokens.get('access_token', ''),
                'refresh_token':  tokens.get('refresh_token', ''),
                'expires_at':     expires_at.isoformat(),
                'scope':          tokens.get('scope', ''),
                'calendar_email': calendar_email,
            })
            return {"status": "success", "provider": "microsoft", "email": calendar_email}

        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    # ── calendar_disconnect:google | calendar_disconnect:microsoft ─────────
    if action.startswith("calendar_disconnect:"):
        provider = action.split(":", 1)[1]
        db.delete_oauth_tokens(user_id, provider)
        return {"status": "success", "provider": provider, "connected": False}

    raise HTTPException(status_code=400, detail=f"Unknown action: '{action}'")


@app.get("/api/profile", response_model=dict)
def get_user_profile(request: Request):
    identity = get_current_user(request)
    user_id = identity["user_id"]

    db.ensure_user_profile(user_id, identity["email"], identity["display_name"])

    profile = db.get_profile(user_id)
    fairness = db.get_fairness_state(user_id)

    if not profile:
        raise HTTPException(status_code=404, detail="User not found")

    metrics = fairness.meetingLoadMetrics if fairness else {}
    return {
        "id": user_id,
        "name": profile.displayName,
        "email": profile.email,
        "role": "Cloud Architect",
        "fairness_score": float(fairness.fairnessScore) if fairness else 100.0,
        "details": {
            "meetings_this_week": metrics.get("meetings_this_week", 0),
            "cancellations_last_month": metrics.get("cancellations_last_month", 0),
            "suffering_score": metrics.get("suffering_score", 0),
        }
    }


@app.get("/api/meetings")
def get_meetings(request: Request):
    identity = get_current_user(request)
    user_id = identity["user_id"]

    meetings = db.get_user_meetings(user_id)
    all_participant_ids: set = set()
    for m in meetings:
        for pid in m.participantUserIds:
            all_participant_ids.add(pid)
    name_map = db.get_users_by_ids(list(all_participant_ids))
    response_data = []
    for m in meetings:
        slots = db.get_meeting_slots(m.requestId)
        meeting_dict = m.model_dump(mode="json")
        meeting_dict['slots'] = [s.model_dump(mode="json") for s in slots]
        meeting_dict['userRole'] = 'organizer' if m.creatorUserId == user_id else 'participant'
        meeting_dict['participantNames'] = {pid: name_map.get(pid, {"name": pid, "email": ""})
                                            for pid in m.participantUserIds}
        response_data.append(meeting_dict)

    return response_data


@app.post("/api/meetings/create")
def create_meeting(meeting_data: models.MeetingCreateSchema, request: Request):
    """
    Creates a new meeting request.

    Resolves participantEmails → user IDs before scheduling.
    If Step Functions is configured (AWS_ACCOUNT_ID is set), runs the full
    state machine workflow. Otherwise falls back to direct in-process computation.
    """
    identity = get_current_user(request)
    user_id = identity["user_id"]

    # Resolve participant emails to user IDs
    if meeting_data.participantEmails:
        found_users = db.get_users_by_emails(meeting_data.participantEmails)
        resolved_ids = list(meeting_data.participantIds)
        for u in found_users:
            uid = u.get('userId', '')
            if uid and uid not in resolved_ids and uid != user_id:
                resolved_ids.append(uid)
        meeting_data.participantIds = resolved_ids

    account_id = os.environ.get('AWS_ACCOUNT_ID', '')
    use_step_functions = bool(account_id)  # Only use SFN in AWS environment

    if use_step_functions:
        # 1. Create the meeting record first (so we have a request_id)
        from datetime import datetime, timedelta
        meeting = db.create_meeting_record(meeting_data, user_id)

        # 2. Trigger the Step Functions workflow synchronously
        sfn_input = {
            "request_id": meeting.requestId,
            "creator_id": user_id,
            "participant_ids": meeting_data.participantIds,
            "date_range_start": meeting.dateRangeStart.isoformat(),
            "date_range_end": meeting.dateRangeEnd.isoformat(),
            "duration_minutes": meeting.durationMinutes
        }

        try:
            sfn = get_sfn_client()
            response = sfn.start_sync_execution(
                stateMachineArn=get_state_machine_arn(),
                name=f"schedule-{meeting.requestId}",
                input=json.dumps(sfn_input)
            )
            if response['status'] == 'FAILED':
                raise Exception(response.get('error', 'Workflow failed'))
        except Exception as e:
            # If Step Functions fails, fall back to direct computation
            _run_local_scheduling(meeting_data, user_id, meeting.requestId)

        return meeting
    else:
        # Local dev / fallback: run the fairness engine directly in-process
        return db.create_meeting_with_simulation(meeting_data, user_id)


def _run_local_scheduling(meeting_data, user_id: str, request_id: str):
    """Direct in-process fallback when Step Functions is not available."""
    from datetime import datetime, timedelta
    payload = {
        "request_id": request_id,
        "creator_id": user_id,
        "participant_ids": meeting_data.participantIds,
        "date_range_start": datetime.now().isoformat(),
        "date_range_end": (datetime.now() + timedelta(days=meeting_data.daysForward)).isoformat(),
        "duration_minutes": meeting_data.durationMinutes
    }
    payload = db.sfn_fetch_participants(payload)
    payload = db.sfn_generate_slots(payload)
    payload = db.sfn_calculate_fairness(payload)
    if payload.get('optimization_needed'):
        payload = db.sfn_reshuffle_slots(payload)
    db.sfn_store_results(payload)


@app.post("/api/meetings/{request_id}/book/{slot_start_iso}")
def book_meeting_slot(request_id: str, slot_start_iso: str, request: Request):
    """
    Books a specific time slot for a meeting.
    Also updates the user's fairness score via the FairnessEngine.
    """
    identity = get_current_user(request)
    user_id = identity["user_id"]

    meeting = db._get_item(f"MEET#{request_id}", "META")
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Get the slot's fairness impact for score update
    slot_data = db._get_item(f"MEET#{request_id}", f"SLOT#{slot_start_iso}")
    fairness_impact = float(slot_data.get('fairnessImpact', -2.0)) if slot_data else -2.0

    # Update user's fairness score
    db.update_fairness_on_booking(user_id, fairness_impact)

    # Confirm the meeting
    meeting['status'] = 'confirmed'
    meeting['selectedSlotStart'] = slot_start_iso
    db._put_item(f"MEET#{request_id}", "META", meeting)

    return {"status": "success", "message": "Meeting confirmed successfully", "meeting": meeting}


@app.post("/api/meetings/{request_id}/accept")
def accept_meeting(request_id: str, request: Request):
    """
    Participant accepts a confirmed meeting invitation.
    Adds their user ID to the meeting's acceptedBy list.
    """
    identity = get_current_user(request)
    user_id = identity["user_id"]

    meeting = db._get_item(f"MEET#{request_id}", "META")
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    participant_ids = meeting.get('participantUserIds', [])
    if user_id not in participant_ids:
        raise HTTPException(status_code=403, detail="You are not a participant in this meeting")

    accepted_by = meeting.get('acceptedBy', [])
    if user_id not in accepted_by:
        accepted_by.append(user_id)
    meeting['acceptedBy'] = accepted_by

    db._put_item(f"MEET#{request_id}", "META", meeting)
    return {"status": "success", "message": "Meeting accepted", "acceptedBy": accepted_by}
