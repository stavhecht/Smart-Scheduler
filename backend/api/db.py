from typing import List, Optional, Any
from datetime import datetime, timedelta
import uuid
import os

from models import UserProfile, MeetingRequest, SuggestedTimeSlot, FairnessState, MeetingCreateSchema
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

    _put_item(f"USER#{user_id}", "PROFILE", UserProfile(
        userId=user_id,
        email=email,
        displayName=display_name,
        timezone="Asia/Jerusalem",
        workingHours={"start": "09:00", "end": "18:00"}
    ).model_dump(mode="json"))

    _put_item(f"USER#{user_id}", "FAIRNESS", FairnessState(
        userId=user_id,
        fairnessScore=100.0,
        meetingLoadMetrics={"meetings_this_week": 0, "cancellations_last_month": 0, "suffering_score": 0},
        inconvenientMeetingsCount=0
    ).model_dump(mode="json"))


def get_profile(user_id: str) -> Optional[UserProfile]:
    data = _get_item(f"USER#{user_id}", "PROFILE")
    return UserProfile(**data) if data else None


def get_fairness_state(user_id: str) -> Optional[FairnessState]:
    data = _get_item(f"USER#{user_id}", "FAIRNESS")
    return FairnessState(**data) if data else None


def update_fairness_on_booking(user_id: str, slot_fairness_impact: float):
    """
    Called when a user books a meeting slot.
    Updates their fairness score and meeting load metrics in DynamoDB.
    """
    fairness = get_fairness_state(user_id)
    if not fairness:
        return

    current_state = {
        'fairnessScore': float(fairness.fairnessScore),
        'meetingLoadMetrics': fairness.meetingLoadMetrics
    }
    updated = fairness_engine.update_score_after_booking(current_state, slot_fairness_impact)

    _put_item(f"USER#{user_id}", "FAIRNESS", {
        'userId': user_id,
        'fairnessScore': updated['fairnessScore'],
        'meetingLoadMetrics': updated['meetingLoadMetrics'],
        'inconvenientMeetingsCount': fairness.inconvenientMeetingsCount + updated['inconvenientMeetingsCount'],
        'lastUpdatedAt': datetime.now().isoformat()
    })


# ---------------------------------------------------------------------------
# Meetings
# ---------------------------------------------------------------------------

def get_user_meetings(user_id: str) -> List[MeetingRequest]:
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
            meetings.append(MeetingRequest(**item))
        except Exception:
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


def get_meeting_slots(request_id: str) -> List[SuggestedTimeSlot]:
    items = _query_begins_with(f"MEET#{request_id}", "SLOT#")
    slots = [SuggestedTimeSlot(**item) for item in items]
    slots.sort(key=lambda x: x.score, reverse=True)
    return slots


# ---------------------------------------------------------------------------
# Meeting creation
# ---------------------------------------------------------------------------

def create_meeting_record(req_data: MeetingCreateSchema, creator_id: str) -> MeetingRequest:
    """Create the meeting record in DynamoDB (without slots). Returns the new meeting."""
    req_id = f"m{uuid.uuid4().hex[:6]}"
    new_meeting = MeetingRequest(
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


def create_meeting_with_simulation(req_data: MeetingCreateSchema, creator_id: str) -> MeetingRequest:
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
        best_slots = fairness_engine.select_best_slots(all_scored, count=3)

    # Persist the final slots
    for slot_data in best_slots:
        slot = SuggestedTimeSlot(
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
        best_slots = fairness_engine.select_best_slots(scored_slots, count=3)

    for slot_data in best_slots:
        slot = SuggestedTimeSlot(
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
    _put_item(f"USER#{user_id}", "PROFILE", UserProfile(
        userId=user_id, email="yoed@example.com", displayName="Yoed (Dev)",
        timezone="Asia/Jerusalem", workingHours={"start": "09:00", "end": "18:00"}
    ).model_dump(mode="json"))
    _put_item(f"USER#{user_id}", "FAIRNESS", FairnessState(
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
