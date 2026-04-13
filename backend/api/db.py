from decimal import Decimal
from typing import List, Optional, Any, Dict
from datetime import datetime, timedelta, timezone
import uuid
import json
import os
try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None  # Python < 3.9 fallback

import models
from fairness_engine import engine as fairness_engine

import boto3
from boto3.dynamodb.conditions import Key, Attr

# ---------------------------------------------------------------------------
# Timezone helpers
# ---------------------------------------------------------------------------

def get_tz_offset_hours(tz_name: str) -> float:
    """
    Return the current UTC offset in hours for a given IANA timezone name.
    Uses stdlib zoneinfo (Python 3.9+). Falls back to 0.0 on error.
    Example: "Asia/Jerusalem" → 3.0 (during summer), 2.0 (winter)
    """
    if not tz_name or not ZoneInfo:
        return 0.0
    try:
        tz = ZoneInfo(tz_name)
        now_local = datetime.now(tz)
        offset = now_local.utcoffset()
        return offset.total_seconds() / 3600.0 if offset else 0.0
    except Exception:
        return 0.0


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
            item[k] = Decimal(str(v))
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


def mark_messages_read(user_id: str):
    """Mark all unread messages for a user as read (batch update)."""
    items = _query_begins_with(f"USER#{user_id}", "MSG#")
    for item in items:
        if not item.get('isRead', False):
            pk = item.get('PK', f"USER#{user_id}")
            sk = item.get('SK', '')
            if sk:
                try:
                    table.update_item(
                        Key={'PK': pk, 'SK': sk},
                        UpdateExpression='SET isRead = :r',
                        ExpressionAttributeValues={':r': True},
                    )
                except Exception:
                    pass


def _get_working_hours_list(participant_working_hours: List[dict]) -> List[int]:
    """
    Compute the intersection of participants' working hours and return candidate local hours.
    Skips lunch hour (12). Falls back to default WORKING_HOURS on any error.
    """
    if not participant_working_hours:
        return fairness_engine.WORKING_HOURS
    try:
        starts = [int(wh.get('start', '09:00').split(':')[0]) for wh in participant_working_hours]
        ends   = [int(wh.get('end',   '18:00').split(':')[0]) for wh in participant_working_hours]
        wh_start = max(starts)   # latest start = safe intersection
        wh_end   = min(ends)     # earliest end = safe intersection
        if wh_start >= wh_end:
            return fairness_engine.WORKING_HOURS
        hours = [h for h in range(max(7, wh_start), min(19, wh_end)) if h != 12]
        return hours if hours else fairness_engine.WORKING_HOURS
    except Exception:
        return fairness_engine.WORKING_HOURS


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

def _write_participation_records(meeting: models.MeetingRequest):
    """
    Write USER#{userId}/PART#{meetingId} index records for all meeting participants.
    This allows O(1) lookup of a user's meetings instead of full-table scan.
    """
    all_ids = list(set([meeting.creatorUserId] + (meeting.participantUserIds or [])))
    for uid in all_ids:
        if uid:
            _put_item(f"USER#{uid}", f"PART#{meeting.requestId}", {
                'meetingId': meeting.requestId,
                'role': 'creator' if uid == meeting.creatorUserId else 'participant',
                'addedAt': datetime.now().isoformat(),
            })


def get_user_meetings(user_id: str) -> List[models.MeetingRequest]:
    """
    Returns meetings where user is creator OR a participant.
    Uses participation index records (USER#{id}/PART#*) for O(1) lookup.
    Falls back to scan for legacy meetings without index records.
    """
    # 1. Query the participation index for this user
    part_items = _query_begins_with(f"USER#{user_id}", "PART#")
    meeting_ids_from_index = {item.get('meetingId') for item in part_items if item.get('meetingId')}

    meetings = []
    fetched_ids = set()

    # Batch-fetch meetings found in index
    for mid in meeting_ids_from_index:
        meeting_item = _get_item(f"MEET#{mid}", "META")
        if meeting_item:
            try:
                meetings.append(models.MeetingRequest(**meeting_item))
                fetched_ids.add(mid)
            except Exception as exc:
                print(f"[db] Failed to parse meeting {mid}: {exc}")

    # 2. Legacy fallback: scan for meetings not yet indexed (one-time migration cost)
    legacy_items = _paginate_scan(
        FilterExpression=(
            Attr('PK').begins_with('MEET#') &
            Attr('SK').eq('META') &
            (Attr('creatorUserId').eq(user_id) | Attr('participantUserIds').contains(user_id))
        )
    )
    for item in legacy_items:
        mid = item.get('requestId', '')
        if mid and mid not in fetched_ids:
            try:
                m = models.MeetingRequest(**item)
                meetings.append(m)
                # Auto-backfill participation index records for this legacy meeting
                _write_participation_records(m)
            except Exception as exc:
                print(f"[db] Failed to parse legacy meeting {item.get('PK')}: {exc}")

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


def get_recent_activity(user_id: str, limit: int = 12) -> List[dict]:
    """
    Returns recent meeting activity entries for a user.
    Queries participation index for meeting IDs, then fetches LOG# entries.
    Returns top N sorted by time descending.
    """
    part_items = _query_begins_with(f"USER#{user_id}", "PART#")
    meeting_ids = [item.get('meetingId') for item in part_items if item.get('meetingId')]
    meeting_ids = meeting_ids[:20]  # cap to avoid excessive queries

    all_logs = []
    for mid in meeting_ids:
        meeting = _get_item(f"MEET#{mid}", "META")
        if not meeting:
            continue
        meeting_title = meeting.get('title', 'Meeting')
        log_items = _query_begins_with(f"MEET#{mid}", "LOG#")
        for log in log_items:
            all_logs.append({
                'meetingId':    mid,
                'meetingTitle': meeting_title,
                'action':       log.get('action', ''),
                'by':           log.get('by', ''),
                'at':           log.get('at', ''),
            })

    all_logs.sort(key=lambda x: x.get('at', ''), reverse=True)
    return all_logs[:limit]


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
                 duration_minutes: Optional[int] = None,
                 description: Optional[str] = None) -> Optional[dict]:
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
    if description is not None and description != meeting.get('description', ''):
        changes['description'] = {'from': meeting.get('description', ''), 'to': description}
        meeting['description'] = description
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


def get_user_ics_url(user_id: str) -> str:
    """Returns the user's public .ics calendar feed URL, or empty string if not set."""
    profile = _get_item(f"USER#{user_id}", "PROFILE")
    return (profile or {}).get('icsUrl', '')


def save_user_ics_url(user_id: str, ics_url: str):
    """Saves the user's .ics feed URL to their profile item."""
    profile_data = _get_item(f"USER#{user_id}", "PROFILE")
    if not profile_data:
        return
    profile_data['icsUrl'] = ics_url
    _put_item(f"USER#{user_id}", "PROFILE", profile_data)


def save_oauth_state(user_id: str, provider: str, state: str):
    """Store a short-lived OAuth state nonce (10 min TTL)."""
    import time
    _put_item(f"USER#{user_id}", f"OAUTH_STATE#{state}", {
        'provider': provider,
        'state': state,
        'ttlExpiry': int(time.time()) + 1800,  # 30 min
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
        description=getattr(req_data, 'description', '') or '',
        durationMinutes=req_data.durationMinutes,
        dateRangeStart=datetime.now(),
        dateRangeEnd=datetime.now() + timedelta(days=req_data.daysForward),
        status="pending"
    )
    _put_item(f"MEET#{req_id}", "META", new_meeting.model_dump(mode="json"))
    # Write participation index records for fast user→meetings lookup
    _write_participation_records(new_meeting)
    return new_meeting


def create_meeting_with_simulation(req_data: models.MeetingCreateSchema, creator_id: str) -> models.MeetingRequest:
    """
    Fallback path (used when Step Functions is not configured).
    Creates a meeting and uses the real FairnessEngine for slot scoring.
    Uses participant timezones, working hours intersection, and live calendar conflicts.
    """
    meeting = create_meeting_record(req_data, creator_id)
    all_pids = list(set([creator_id] + (req_data.participantIds or [])))

    # Fetch fairness states and profiles for all participants
    participant_states = []
    participant_profiles = []
    for uid in all_pids:
        state = _get_item(f"USER#{uid}", "FAIRNESS")
        if state:
            participant_states.append(state)
        profile = _get_item(f"USER#{uid}", "PROFILE")
        if profile:
            participant_profiles.append(profile)

    # Resolve organizer's timezone offset (for impact + explanation)
    creator_profile = next((p for p in participant_profiles if p.get('userId') == creator_id), None)
    creator_tz = (creator_profile or {}).get("timezone", "UTC")
    tz_offset = get_tz_offset_hours(creator_tz)

    # Per-participant timezone offsets (for averaged time scoring)
    participant_tz_offsets = [
        get_tz_offset_hours(p.get('timezone', 'UTC')) for p in participant_profiles
    ] if participant_profiles else None

    # Working hours intersection across all participants
    working_hours_data = [p.get('workingHours', {'start': '09:00', 'end': '18:00'}) for p in participant_profiles]
    wh_list = _get_working_hours_list(working_hours_data)

    # Generate candidate slots aligned to working hours intersection
    candidates = fairness_engine.generate_candidate_slots(
        meeting.dateRangeStart, meeting.dateRangeEnd,
        tz_offset_hours=tz_offset, working_hours=wh_list
    )

    # Fetch calendar busy slots for ALL participants
    import calendar_client as _cc
    all_busy: Dict[str, list] = {}
    for uid in all_pids:
        try:
            busy = _cc.get_user_busy_slots(uid, meeting.dateRangeStart, meeting.dateRangeEnd)
            if busy:
                all_busy[uid] = busy
        except Exception:
            pass

    def _conflict_count(slot_dt: datetime) -> int:
        """Count how many participants have a calendar conflict at this slot."""
        slot_end = slot_dt + timedelta(minutes=meeting.durationMinutes)
        count = 0
        for uid, busy_list in all_busy.items():
            for b in busy_list:
                try:
                    b_start = datetime.fromisoformat(b['start'].rstrip('Z'))
                    b_end   = datetime.fromisoformat(b['end'].rstrip('Z'))
                    if slot_dt < b_end and slot_end > b_start:
                        count += 1
                        break
                except Exception:
                    pass
        return count

    # Filter slots where the creator has a hard conflict
    creator_busy = all_busy.get(creator_id, [])
    if creator_busy:
        def _creator_conflicts(slot_dt):
            slot_end = slot_dt + timedelta(minutes=meeting.durationMinutes)
            for b in creator_busy:
                try:
                    b_start = datetime.fromisoformat(b['start'].rstrip('Z'))
                    b_end   = datetime.fromisoformat(b['end'].rstrip('Z'))
                    if slot_dt < b_end and slot_end > b_start:
                        return True
                except Exception:
                    pass
            return False
        candidates = [c for c in candidates if not _creator_conflicts(c)]

    # Score each candidate with real conflict counts and per-participant timezones
    all_scored = []
    for slot_dt in candidates:
        busy_count = _conflict_count(slot_dt)
        result = fairness_engine.score_time_slot(
            slot_dt, participant_states, meeting.durationMinutes,
            tz_offset_hours=tz_offset,
            participant_tz_offsets=participant_tz_offsets,
            busy_count=busy_count,
        )
        end_dt = slot_dt + timedelta(minutes=meeting.durationMinutes)
        all_scored.append({
            "startIso": slot_dt.isoformat() + 'Z',
            "endIso": end_dt.isoformat() + 'Z',
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
    Fetches the fairness states AND profiles (timezone, working hours) for all participants.
    """
    creator_id = payload.get('creator_id', '')
    participant_ids = payload.get('participant_ids', [])

    all_ids = list(set([creator_id] + participant_ids))
    participant_states = []
    participant_profiles = []
    for uid in all_ids:
        state = _get_item(f"USER#{uid}", "FAIRNESS")
        if state:
            participant_states.append(state)
        profile = _get_item(f"USER#{uid}", "PROFILE")
        if profile:
            participant_profiles.append({
                'userId':       uid,
                'timezone':     profile.get('timezone', 'UTC'),
                'workingHours': profile.get('workingHours', {'start': '09:00', 'end': '18:00'}),
            })

    payload['participant_states']   = participant_states
    payload['participant_profiles'] = participant_profiles
    return payload


def sfn_generate_slots(payload: dict) -> dict:
    """
    SFN State: GenerateCandidateSlots
    Generates candidate time slots using the working hours intersection of all participants.
    Also pre-computes per-slot calendar conflict counts.
    """
    date_start       = datetime.fromisoformat(payload['date_range_start'])
    date_end         = datetime.fromisoformat(payload['date_range_end'])
    duration_minutes = payload.get('duration_minutes', 60)
    tz_offset        = float(payload.get('tz_offset_hours', 0.0))
    profiles         = payload.get('participant_profiles', [])

    # Working hours intersection
    wh_data = [p.get('workingHours', {'start': '09:00', 'end': '18:00'}) for p in profiles]
    wh_list = _get_working_hours_list(wh_data)

    candidates = fairness_engine.generate_candidate_slots(
        date_start, date_end, tz_offset_hours=tz_offset, working_hours=wh_list
    )
    end_delta = timedelta(minutes=duration_minutes)

    # Fetch calendar busy slots for all participants (best-effort)
    import calendar_client as _cc
    all_busy: Dict[str, list] = {}
    creator_id = payload.get('creator_id', '')
    all_ids = list({creator_id} | set(payload.get('participant_ids', [])))
    for uid in all_ids:
        try:
            busy = _cc.get_user_busy_slots(uid, date_start, date_end)
            if busy:
                all_busy[uid] = busy
        except Exception:
            pass

    def _conflict_count(slot_dt: datetime) -> int:
        slot_end = slot_dt + end_delta
        count = 0
        for uid, busy_list in all_busy.items():
            for b in busy_list:
                try:
                    b_start = datetime.fromisoformat(b['start'].rstrip('Z'))
                    b_end   = datetime.fromisoformat(b['end'].rstrip('Z'))
                    if slot_dt < b_end and slot_end > b_start:
                        count += 1
                        break
                except Exception:
                    pass
        return count

    # Filter creator hard-conflicts
    creator_busy = all_busy.get(creator_id, [])
    if creator_busy:
        def _creator_conflicts(slot_dt):
            slot_end = slot_dt + end_delta
            for b in creator_busy:
                try:
                    b_start = datetime.fromisoformat(b['start'].rstrip('Z'))
                    b_end   = datetime.fromisoformat(b['end'].rstrip('Z'))
                    if slot_dt < b_end and slot_end > b_start:
                        return True
                except Exception:
                    pass
            return False
        candidates = [c for c in candidates if not _creator_conflicts(c)]

    payload['candidate_slots'] = [
        {
            "startIso":      dt.isoformat() + 'Z',
            "endIso":        (dt + end_delta).isoformat() + 'Z',
            "conflictCount": _conflict_count(dt),
        }
        for dt in candidates
    ]
    return payload


def sfn_calculate_fairness(payload: dict) -> dict:
    """
    SFN State: CalculateFairnessScores
    Scores each candidate slot using per-participant timezones and real conflict counts.
    Also determines whether the Reshuffling Engine needs to activate.
    """
    participant_states  = payload.get('participant_states', [])
    candidate_slots     = payload.get('candidate_slots', [])
    duration_minutes    = payload.get('duration_minutes', 60)
    profiles            = payload.get('participant_profiles', [])

    tz_offset = float(payload.get('tz_offset_hours', 0.0))
    # Per-participant timezone offsets for averaged time scoring
    participant_tz_offsets = [get_tz_offset_hours(p.get('timezone', 'UTC')) for p in profiles] or None

    scored = []
    for slot in candidate_slots:
        dt          = datetime.fromisoformat(slot['startIso'])
        busy_count  = int(slot.get('conflictCount', 0))
        result = fairness_engine.score_time_slot(
            dt, participant_states, duration_minutes,
            tz_offset_hours=tz_offset,
            participant_tz_offsets=participant_tz_offsets,
            busy_count=busy_count,
        )
        scored.append({**slot, **result})

    payload['scored_slots']        = scored
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
# User stats (real metrics derived from meeting records)
# ---------------------------------------------------------------------------

def get_user_stats(user_id: str) -> dict:
    """
    Compute real usage stats for a user from their DynamoDB meeting records.
    Returns total_organized, total_accepted, total_cancelled, avg_fairness_score.
    """
    meetings = get_user_meetings(user_id)

    total_organized  = sum(1 for m in meetings if m.creatorUserId == user_id)
    total_accepted   = sum(1 for m in meetings if m.status == 'confirmed')
    total_cancelled  = sum(1 for m in meetings if m.status == 'cancelled')

    # Fairness score history from the FAIRNESS record
    fairness_item = _get_item(f"USER#{user_id}", "FAIRNESS")
    current_score = float(fairness_item.get('fairnessScore', 100)) if fairness_item else 100.0

    return {
        'total_organized': total_organized,
        'total_accepted':  total_accepted,
        'total_cancelled': total_cancelled,
        'current_fairness_score': round(current_score, 1),
        'meetings_this_week': int(
            float(fairness_item.get('meetingLoadMetrics', {}).get('meetings_this_week', 0))
        ) if fairness_item else 0,
        'suffering_score': int(
            float(fairness_item.get('meetingLoadMetrics', {}).get('suffering_score', 0))
        ) if fairness_item else 0,
    }


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


# ---------------------------------------------------------------------------
# People / Team directory
# ---------------------------------------------------------------------------

def get_all_users(exclude_user_id: str) -> list:
    """Fetch all user profiles excluding the calling user. Cap at 50."""
    all_profiles = _paginate_scan(FilterExpression=Attr('SK').eq('PROFILE'))
    result = []
    for p in all_profiles:
        uid = p.get('userId', '')
        if uid and uid != exclude_user_id:
            fairness = _get_item(f"USER#{uid}", "FAIRNESS")
            p['fairness_score'] = float(fairness.get('fairnessScore', 100)) if fairness else 100.0
            result.append(p)
        if len(result) >= 50:
            break
    return result


def get_shared_meetings(user_a_id: str, user_b_id: str) -> dict:
    """Find meetings shared between two users via participation index."""
    a_parts = {item.get('meetingId') for item in _query_begins_with(f"USER#{user_a_id}", "PART#") if item.get('meetingId')}
    b_parts = {item.get('meetingId') for item in _query_begins_with(f"USER#{user_b_id}", "PART#") if item.get('meetingId')}
    shared_ids = a_parts & b_parts
    recent_titles = []
    for mid in list(shared_ids)[:5]:
        m = _get_item(f"MEET#{mid}", "META")
        if m and m.get('status') == 'confirmed':
            recent_titles.append(m.get('title', ''))
    return {'count': len(shared_ids), 'recentTitles': recent_titles[:3]}


if os.environ.get("SEED_DEMO_DATA") == "true":
    init_db()
