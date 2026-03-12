from typing import List, Optional, Any, Dict
from datetime import datetime, timedelta
import uuid
import json
import os

import models
from fairness_engine import engine as fairness_engine

import boto3
from boto3.dynamodb.conditions import Key, Attr

# --- DynamoDB connection ---
DYNAMODB_TABLE_NAME = os.environ.get("TABLE_NAME", "SmartScheduler_V1")
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(DYNAMODB_TABLE_NAME)


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def _put_item(pk: str, sk: str, data: dict):
    item = data.copy()
    item['PK'] = pk
    item['SK'] = sk
    for k, v in item.items():
        if isinstance(v, float):
            item[k] = str(v)
        elif isinstance(v, datetime):
            item[k] = v.isoformat()
    table.put_item(Item=item)


def _get_item(pk: str, sk: str) -> Optional[dict]:
    response = table.get_item(Key={'PK': pk, 'SK': sk})
    return response.get('Item')


def _query_begins_with(pk: str, sk_prefix: str) -> List[dict]:
    response = table.query(
        KeyConditionExpression=Key('PK').eq(pk) & Key('SK').begins_with(sk_prefix)
    )
    return response.get('Items', [])


def _paginate_scan(**kwargs) -> List[dict]:
    """DynamoDB scan with automatic pagination (handles tables > 1 MB)."""
    items: List[dict] = []
    while True:
        response = table.scan(**kwargs)
        items.extend(response.get('Items', []))
        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            break
        kwargs['ExclusiveStartKey'] = last_key
    return items


# ---------------------------------------------------------------------------
# User profile / fairness
# ---------------------------------------------------------------------------

def ensure_user_profile(user_id: str, email: str, display_name: str):
    """Auto-create user profile on first Cognito login."""
    if _get_item(f"USER#{user_id}", "PROFILE"):
        return

    _put_item(f"USER#{user_id}", "PROFILE", models.UserProfile(
        userId=user_id,
        email=email,
        displayName=display_name,
        timezone="Asia/Jerusalem",
        workingHours={"start": "09:00", "end": "18:00"}
    ).model_dump(mode="json"))

    _put_item(f"USER#{user_id}", "FAIRNESS", models.FairnessState(
        userId=user_id,
        fairnessScore=100.0,
        meetingLoadMetrics={"meetings_this_week": 0, "cancellations_last_month": 0, "suffering_score": 0},
        inconvenientMeetingsCount=0
    ).model_dump(mode="json"))


def get_profile(user_id: str) -> Optional[models.UserProfile]:
    data = _get_item(f"USER#{user_id}", "PROFILE")
    return models.UserProfile(**data) if data else None


def get_fairness_state(user_id: str) -> Optional[models.FairnessState]:
    data = _get_item(f"USER#{user_id}", "FAIRNESS")
    return models.FairnessState(**data) if data else None


def update_profile(user_id: str, updates: dict):
    profile_data = _get_item(f"USER#{user_id}", "PROFILE")
    if not profile_data:
        return None
    
    # Merge updates
    for k, v in updates.items():
        if k in models.UserProfile.model_fields:
            profile_data[k] = v
    
    _put_item(f"USER#{user_id}", "PROFILE", profile_data)
    return models.UserProfile(**profile_data)


def send_profile_message(from_uid: str, to_uid: str, content: str, msg_type: str = "general"):
    """Sends a message from one user to another."""
    from_profile = get_profile(from_uid)
    from_name = from_profile.displayName if from_profile else from_uid[:8]
    
    msg_id = f"msg_{uuid.uuid4().hex[:8]}"
    msg = models.ProfileMessage(
        messageId=msg_id,
        fromUserId=from_uid,
        toUserId=to_uid,
        fromDisplayName=from_name,
        content=content,
        messageType=msg_type
    )
    
    # Store in recipient's Inbox
    _put_item(f"USER#{to_uid}", f"MSG#{msg.createdAt.isoformat()}#{msg_id}", msg.model_dump(mode="json"))
    return msg


def get_profile_messages(user_id: str, limit: int = 20) -> List[models.ProfileMessage]:
    """Fetches messages sent to a user, newest first."""
    items = _query_begins_with(f"USER#{user_id}", "MSG#")
    msgs = []
    for item in items:
        try:
            msgs.append(models.ProfileMessage(**item))
        except Exception:
            pass
    msgs.sort(key=lambda x: x.createdAt, reverse=True)
    return msgs[:limit]


def update_fairness_on_booking(user_ids: List[str], slot_fairness_impact: float):
    """
    Updates fairness scores and meeting load metrics for all participants.
    Auto-initializes states for participants who haven't logged in yet.
    """
    for uid in user_ids:
        fairness = get_fairness_state(uid)
        
        # Auto-initialize if missing (e.g. participant hasn't logged in yet)
        if not fairness:
            _put_item(f"USER#{uid}", "FAIRNESS", models.FairnessState(
                userId=uid,
                fairnessScore=100.0,
                meetingLoadMetrics={"meetings_this_week": 0, "cancellations_last_month": 0, "suffering_score": 0},
                inconvenientMeetingsCount=0
            ).model_dump(mode="json"))
            fairness = get_fairness_state(uid)

        if not fairness:
            continue

        current_state = {
            'fairnessScore': float(fairness.fairnessScore),
            'meetingLoadMetrics': fairness.meetingLoadMetrics
        }
        updated = fairness_engine.update_score_after_booking(current_state, slot_fairness_impact)

        _put_item(f"USER#{uid}", "FAIRNESS", {
            'userId': uid,
            'fairnessScore': updated['fairnessScore'],
            'meetingLoadMetrics': updated['meetingLoadMetrics'],
            'inconvenientMeetingsCount': fairness.inconvenientMeetingsCount + updated['inconvenientMeetingsCount'],
            'lastUpdatedAt': datetime.now().isoformat()
        })


# ---------------------------------------------------------------------------
# Meetings
# ---------------------------------------------------------------------------

def get_user_meetings(user_id: str) -> List[models.MeetingRequest]:
    """Returns meetings where user is creator OR a participant (paginated scan)."""
    items = _paginate_scan(
        FilterExpression=(
            Attr('PK').begins_with('MEET#') &
            Attr('SK').eq('META') &
            (Attr('creatorUserId').eq(user_id) | Attr('participantUserIds').contains(user_id))
        )
    )
    meetings = []
    for item in items:
        try:
            meetings.append(models.MeetingRequest(**item))
        except Exception as exc:
            print(f"[db] Failed to parse meeting item {item.get('PK')}: {exc}")
            pass
    meetings.sort(key=lambda x: x.createdAt, reverse=True)
    return meetings


def get_users_by_emails(emails: List[str]) -> List[dict]:
    """Look up registered users by email address (single paginated scan)."""
    normalised = {e.strip().lower() for e in emails if e.strip()}
    if not normalised:
        return []
    # One full scan filtered to PROFILE items, then match in Python
    # This is O(1) scan instead of O(N) separate scans.
    all_profiles = _paginate_scan(
        FilterExpression=Attr('SK').eq('PROFILE')
    )
    return [p for p in all_profiles if p.get('email', '').lower() in normalised]


def get_meeting_slots(request_id: str) -> List[models.SuggestedTimeSlot]:
    items = _query_begins_with(f"MEET#{request_id}", "SLOT#")
    slots = [models.SuggestedTimeSlot(**item) for item in items]
    slots.sort(key=lambda x: x.score, reverse=True)
    return slots


def delete_meeting_slots(request_id: str):
    """Delete all suggested slots for a meeting (used before rescheduling)."""
    slots = _query_begins_with(f"MEET#{request_id}", "SLOT#")
    with table.batch_writer() as batch:
        for s in slots:
            batch.delete_item(Key={'PK': s['PK'], 'SK': s['SK']})


# ---------------------------------------------------------------------------
# Activity log
# ---------------------------------------------------------------------------

def log_meeting_activity(request_id: str, action: str, user_id: str, changes: Optional[dict] = None):
    """Append an activity log entry for a meeting."""
    ts = datetime.now().isoformat()
    item: dict = {"action": action, "by": user_id, "at": ts}
    if changes:
        item["changes"] = json.dumps(changes)
    _put_item(f"MEET#{request_id}", f"LOG#{ts}", item)


def get_meeting_activity_log(request_id: str) -> List[dict]:
    """Returns the activity log entries for a meeting, oldest first."""
    items = _query_begins_with(f"MEET#{request_id}", "LOG#")
    return sorted(items, key=lambda x: x.get('at', ''))


# ---------------------------------------------------------------------------
# Meeting edit / cancel
# ---------------------------------------------------------------------------

def cancel_meeting(request_id: str, cancelled_by: str) -> Optional[dict]:
    """Soft-cancel a meeting. Returns updated meeting dict or None if not found."""
    meeting = _get_item(f"MEET#{request_id}", "META")
    if not meeting:
        return None
    now = datetime.now().isoformat()
    meeting['status']      = 'cancelled'
    meeting['cancelledAt'] = now
    meeting['cancelledBy'] = cancelled_by
    meeting['updatedAt']   = now
    _put_item(f"MEET#{request_id}", "META", meeting)
    log_meeting_activity(request_id, 'cancelled', cancelled_by)
    return meeting


def edit_meeting(request_id: str, edited_by: str, title: Optional[str] = None,
                 duration_minutes: Optional[int] = None) -> Optional[dict]:
    """Edit mutable fields of a meeting. Returns updated meeting dict."""
    meeting = _get_item(f"MEET#{request_id}", "META")
    if not meeting:
        return None
    changes: dict = {}
    if title is not None and title != meeting.get('title'):
        changes['title'] = {'from': meeting.get('title'), 'to': title}
        meeting['title'] = title
    if duration_minutes is not None and duration_minutes != meeting.get('durationMinutes'):
        changes['durationMinutes'] = {'from': meeting.get('durationMinutes'), 'to': duration_minutes}
        meeting['durationMinutes'] = duration_minutes
    if not changes:
        return meeting   # nothing changed
    meeting['updatedAt'] = datetime.now().isoformat()
    _put_item(f"MEET#{request_id}", "META", meeting)
    log_meeting_activity(request_id, 'edited', edited_by, changes)
    return meeting


# ---------------------------------------------------------------------------
# Multi-user: resolve participant IDs → display names
# ---------------------------------------------------------------------------

def get_users_by_ids(user_ids: List[str]) -> Dict[str, dict]:
    """
    Batch-fetch display names for a list of user IDs.
    Returns {userId: {"name": ..., "email": ...}}.
    Uses individual get_item calls (fine for typical meeting sizes of 2-10 people).
    """
    result: Dict[str, dict] = {}
    for uid in user_ids:
        profile = _get_item(f"USER#{uid}", "PROFILE")
        if profile:
            result[uid] = {
                "name":  profile.get("displayName", uid[:8] + "..."),
                "email": profile.get("email", ""),
            }
        else:
            result[uid] = {"name": uid[:8] + "...", "email": ""}
    return result


# ---------------------------------------------------------------------------
# OAuth token storage (Google Calendar / Outlook)
# ---------------------------------------------------------------------------

def get_oauth_tokens(user_id: str, provider: str) -> Optional[dict]:
    """Returns stored OAuth tokens for a provider, or None."""
    return _get_item(f"USER#{user_id}", f"OAUTH#{provider}")


def save_oauth_tokens(user_id: str, provider: str, tokens: dict):
    """Persist OAuth tokens for a calendar provider."""
    item = {
        'provider':     provider,
        'accessToken':  tokens.get('access_token', ''),
        'refreshToken': tokens.get('refresh_token', ''),
        'expiresAt':    tokens.get('expires_at', ''),
        'scopes':       tokens.get('scope', ''),
        'calendarEmail': tokens.get('calendar_email', ''),
        'connectedAt':  datetime.now().isoformat(),
    }
    _put_item(f"USER#{user_id}", f"OAUTH#{provider}", item)


def delete_oauth_tokens(user_id: str, provider: str):
    """Remove OAuth tokens (disconnect calendar)."""
    table.delete_item(Key={'PK': f"USER#{user_id}", 'SK': f"OAUTH#{provider}"})


def get_connected_calendars(user_id: str) -> dict:
    """Returns {provider: {connected: bool, email: str}} for both providers."""
    result = {}
    for provider in ('google', 'microsoft'):
        tokens = get_oauth_tokens(user_id, provider)
        if tokens:
            result[provider] = {
                'connected': True,
                'email': tokens.get('calendarEmail', ''),
                'connectedAt': tokens.get('connectedAt', ''),
            }
        else:
            result[provider] = {'connected': False, 'email': ''}
    return result


def save_oauth_state(user_id: str, provider: str, state: str):
    """Store a short-lived OAuth state nonce (10 min TTL)."""
    import time
    _put_item(f"USER#{user_id}", f"OAUTH_STATE#{state}", {
        'provider': provider,
        'state': state,
        'ttlExpiry': int(time.time()) + 600,   # 10 min
    })


def validate_and_consume_oauth_state(user_id: str, state: str) -> Optional[str]:
    """Validate a state nonce; delete it and return provider, or None if invalid."""
    import time
    item = _get_item(f"USER#{user_id}", f"OAUTH_STATE#{state}")
    if not item:
        return None
    if item.get('ttlExpiry', 0) < int(time.time()):
        return None   # expired
    # consume it
    table.delete_item(Key={'PK': f"USER#{user_id}", 'SK': f"OAUTH_STATE#{state}"})
    return item.get('provider')


# ---------------------------------------------------------------------------
# Meeting creation
# ---------------------------------------------------------------------------

def create_meeting_record(req_data: models.MeetingCreateSchema, creator_id: str) -> models.MeetingRequest:
    """Create the meeting record in DynamoDB (without slots). Returns the new meeting."""
    req_id = f"m{uuid.uuid4().hex[:6]}"
    new_meeting = models.MeetingRequest(
        requestId=req_id,
        creatorUserId=creator_id,
        participantUserIds=req_data.participantIds,
        title=req_data.title,
        durationMinutes=req_data.durationMinutes,
        dateRangeStart=datetime.now(),
        dateRangeEnd=datetime.now() + timedelta(days=req_data.daysForward),
        status="pending"
    )
    _put_item(f"MEET#{req_id}", "META", new_meeting.model_dump(mode="json"))
    return new_meeting


def create_meeting_with_simulation(req_data: models.MeetingCreateSchema, creator_id: str) -> models.MeetingRequest:
    """
    Fallback path (used when Step Functions is not configured).
    Creates a meeting and uses the real FairnessEngine for slot scoring.
    """
    meeting = create_meeting_record(req_data, creator_id)

    # Get creator fairness state for scoring
    creator_state_data = _get_item(f"USER#{creator_id}", "FAIRNESS")
    participant_states = [creator_state_data] if creator_state_data else []

    # Generate candidate slots
    candidates = fairness_engine.generate_candidate_slots(
        meeting.dateRangeStart, meeting.dateRangeEnd
    )

    # Score each candidate
    all_scored = []
    for slot_dt in candidates:
        result = fairness_engine.score_time_slot(slot_dt, participant_states, meeting.durationMinutes)
        end_dt = slot_dt + timedelta(minutes=meeting.durationMinutes)
        all_scored.append({
            "startIso": slot_dt.isoformat(),
            "endIso": end_dt.isoformat(),
            **result
        })

    # Apply Dynamic Reshuffling Engine if needed
    if fairness_engine.needs_optimization(all_scored):
        best_slots = fairness_engine.reshuffle(all_scored)
    else:
        best_slots = fairness_engine.select_best_slots(all_scored, count=8)

    # Persist the final slots
    for slot_data in best_slots:
        slot = models.SuggestedTimeSlot(
            requestId=meeting.requestId,
            startIso=datetime.fromisoformat(slot_data['startIso']),
            endIso=datetime.fromisoformat(slot_data['endIso']),
            score=float(slot_data['score']),
            fairnessImpact=float(slot_data['fairnessImpact']),
            conflictCount=slot_data.get('conflictCount', 0),
            explanation=slot_data['explanation']
        )
        _put_item(
            f"MEET#{meeting.requestId}",
            f"SLOT#{slot.startIso.isoformat()}",
            slot.model_dump(mode="json")
        )

    return meeting


# ---------------------------------------------------------------------------
# Step Functions handler functions
# (Each function receives the full workflow state dict, enriches it, returns it)
# ---------------------------------------------------------------------------

def sfn_fetch_participants(payload: dict) -> dict:
    """
    SFN State: FetchParticipantData
    Fetches the fairness states for all participants.
    """
    creator_id = payload.get('creator_id', '')
    participant_ids = payload.get('participant_ids', [])

    all_ids = list(set([creator_id] + participant_ids))
    participant_states = []
    for uid in all_ids:
        state = _get_item(f"USER#{uid}", "FAIRNESS")
        if state:
            participant_states.append(state)

    payload['participant_states'] = participant_states
    return payload


def sfn_generate_slots(payload: dict) -> dict:
    """
    SFN State: GenerateCandidateSlots
    Generates candidate time slots within the meeting's date range.
    """
    date_start = datetime.fromisoformat(payload['date_range_start'])
    date_end = datetime.fromisoformat(payload['date_range_end'])
    duration_minutes = payload.get('duration_minutes', 60)

    candidates = fairness_engine.generate_candidate_slots(date_start, date_end)
    end_delta = timedelta(minutes=duration_minutes)

    payload['candidate_slots'] = [
        {
            "startIso": dt.isoformat(),
            "endIso": (dt + end_delta).isoformat()
        }
        for dt in candidates
    ]
    return payload


def sfn_calculate_fairness(payload: dict) -> dict:
    """
    SFN State: CalculateFairnessScores
    Scores each candidate slot using the Social Fairness Algorithm.
    Also determines whether the Reshuffling Engine needs to activate.
    """
    participant_states = payload.get('participant_states', [])
    candidate_slots = payload.get('candidate_slots', [])
    duration_minutes = payload.get('duration_minutes', 60)

    scored = []
    for slot in candidate_slots:
        dt = datetime.fromisoformat(slot['startIso'])
        result = fairness_engine.score_time_slot(dt, participant_states, duration_minutes)
        scored.append({**slot, **result})

    payload['scored_slots'] = scored
    payload['optimization_needed'] = fairness_engine.needs_optimization(scored)
    return payload


def sfn_reshuffle_slots(payload: dict) -> dict:
    """
    SFN State: ReshuffleSlots (Dynamic Reshuffling Engine)
    Activated when average scores are below the optimization threshold.
    """
    scored_slots = payload.get('scored_slots', [])
    payload['final_slots'] = fairness_engine.reshuffle(scored_slots)
    return payload


def sfn_store_results(payload: dict) -> dict:
    """
    SFN State: StoreResults
    Persists the final ranked slots to DynamoDB.
    """
    request_id = payload['request_id']
    scored_slots = payload.get('scored_slots', [])

    # Use pre-selected final slots if reshuffling ran, otherwise select best from scoring
    if 'final_slots' in payload:
        best_slots = payload['final_slots']
    else:
        best_slots = fairness_engine.select_best_slots(scored_slots, count=8)

    for slot_data in best_slots:
        slot = models.SuggestedTimeSlot(
            requestId=request_id,
            startIso=datetime.fromisoformat(slot_data['startIso']),
            endIso=datetime.fromisoformat(slot_data['endIso']),
            score=float(slot_data['score']),
            fairnessImpact=float(slot_data['fairnessImpact']),
            conflictCount=slot_data.get('conflictCount', 0),
            explanation=slot_data['explanation']
        )
        _put_item(
            f"MEET#{request_id}",
            f"SLOT#{slot.startIso.isoformat()}",
            slot.model_dump(mode="json")
        )

    payload['stored_slots_count'] = len(best_slots)
    return payload


# ---------------------------------------------------------------------------
# Legacy seed (local dev only)
# ---------------------------------------------------------------------------

def init_db():
    try:
        if _get_item("USER#u1", "PROFILE"):
            return
    except Exception:
        pass

    user_id = "u1"
    _put_item(f"USER#{user_id}", "PROFILE", models.UserProfile(
        userId=user_id, email="yoed@example.com", displayName="Yoed (Dev)",
        timezone="Asia/Jerusalem", workingHours={"start": "09:00", "end": "18:00"}
    ).model_dump(mode="json"))
    _put_item(f"USER#{user_id}", "FAIRNESS", models.FairnessState(
        userId=user_id, fairnessScore=78.5,
        meetingLoadMetrics={"meetings_this_week": 3, "cancellations_last_month": 0, "suffering_score": 2},
        inconvenientMeetingsCount=1
    ).model_dump(mode="json"))

    req_id = "seed-meeting-1"
    tomorrow = datetime.now() + timedelta(days=1)
    meeting_start = tomorrow.replace(hour=10, minute=0, second=0, microsecond=0)
    _put_item(f"MEET#{req_id}", "META", {
        "requestId": req_id,
        "creatorUserId": user_id,
        "participantUserIds": [],
        "title": "Strategy Sync (Demo)",
        "durationMinutes": 60,
        "status": "confirmed",
        "selectedSlotStart": meeting_start.isoformat(),
        "dateRangeStart": datetime.now().isoformat(),
        "dateRangeEnd": (datetime.now() + timedelta(days=3)).isoformat(),
        "createdAt": datetime.now().isoformat()
    })


if os.environ.get("SEED_DEMO_DATA") == "true":
    init_db()
