from typing import List, Optional, Any
from datetime import datetime, timedelta
import random
import uuid
from models import UserProfile, MeetingRequest, SuggestedTimeSlot, FairnessState, MeetingCreateSchema

import boto3
import os

# --- DynamoDB Active Connection ---
DYNAMODB_TABLE_NAME = os.environ.get("TABLE_NAME", "SmartScheduler_V1")
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(DYNAMODB_TABLE_NAME)

def _put_item(pk: str, sk: str, data: dict):
    # Add partition and sort keys to the data
    item = data.copy()
    item['PK'] = pk
    item['SK'] = sk
    # Convert floats to string and datetime to isoformat (DynamoDB expects Decimals or Strings for floats/dates)
    from datetime import datetime
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
    from boto3.dynamodb.conditions import Key
    response = table.query(
        KeyConditionExpression=Key('PK').eq(pk) & Key('SK').begins_with(sk_prefix)
    )
    return response.get('Items', [])

# Initialize on module load (only if SEED_DEMO_DATA=true, for local dev)
def init_db():
    # Helper func to seed DynamoDB with demo data
    try:
        if _get_item("USER#u1", "PROFILE"): return # Don't re-init if already has data
    except Exception:
        pass
    
    user_id = "u1"
    
    _put_item(f"USER#{user_id}", "PROFILE", UserProfile(
        userId=user_id, email="yoed@example.com", displayName="Yoed (AWS)",
        timezone="Asia/Jerusalem", workingHours={"start": "09:00", "end": "18:00"}
    ).model_dump())

    _put_item(f"USER#{user_id}", "FAIRNESS", FairnessState(
        userId=user_id, fairnessScore=78.5,
        meetingLoadMetrics={"meetings_this_week": 12}, inconvenientMeetingsCount=3
    ).model_dump())

    # Seed a confirmed meeting for the calendar
    req_id = "seed-meeting-1"
    tomorrow = datetime.now() + timedelta(days=1)
    meeting_start = tomorrow.replace(hour=10, minute=0, second=0, microsecond=0)
    
    _put_item(f"MEET#{req_id}", "META", {
        "requestId": req_id,
        "creatorUserId": user_id,
        "participantUserIds": ["u2"],
        "title": "Strategy Sync (Mock)",
        "durationMinutes": 60,
        "status": "confirmed",
        "selectedSlotStart": meeting_start.isoformat(),
        "createdAt": datetime.now().isoformat()
    })

if os.environ.get("SEED_DEMO_DATA") == "true":
    init_db()

# --- Repository Functions ---

def ensure_user_profile(user_id: str, email: str, display_name: str):
    """
    Called on every authenticated request.
    Creates a user PROFILE + FAIRNESS record if this is their first login.
    This is the "auto-registration" mechanism for new Cognito users.
    """
    if _get_item(f"USER#{user_id}", "PROFILE"):
        return  # Already exists – nothing to do

    _put_item(f"USER#{user_id}", "PROFILE", UserProfile(
        userId=user_id,
        email=email,
        displayName=display_name,
        timezone="Asia/Jerusalem",
        workingHours={"start": "09:00", "end": "18:00"}
    ).model_dump())

    _put_item(f"USER#{user_id}", "FAIRNESS", FairnessState(
        userId=user_id,
        fairnessScore=50.0,
        meetingLoadMetrics={"meetings_this_week": 0},
        inconvenientMeetingsCount=0
    ).model_dump())

def get_profile(user_id: str):
    data = _get_item(f"USER#{user_id}", "PROFILE")
    return UserProfile(**data) if data else None

def get_fairness_state(user_id: str):
    data = _get_item(f"USER#{user_id}", "FAIRNESS")
    return FairnessState(**data) if data else None

def get_user_meetings(user_id: str):
    """
    Returns all meeting requests created by the given user.
    Uses a DynamoDB scan with a filter on creatorUserId.
    (Acceptable for demo scale; a GSI on creatorUserId would be better at scale.)
    """
    response = table.scan(
        FilterExpression=(
            boto3.dynamodb.conditions.Attr('PK').begins_with('MEET#') &
            boto3.dynamodb.conditions.Attr('SK').eq('META') &
            boto3.dynamodb.conditions.Attr('creatorUserId').eq(user_id)
        )
    )
    meetings = [MeetingRequest(**item) for item in response.get('Items', [])]
    meetings.sort(key=lambda x: x.createdAt, reverse=True)
    return meetings

def get_meeting_slots(request_id: str):
    items = _query_begins_with(f"MEET#{request_id}", "SLOT#")
    slots = [SuggestedTimeSlot(**item) for item in items]
    slots.sort(key=lambda x: x.score, reverse=True) # Best score first
    return slots

def create_meeting_with_simulation(req_data: MeetingCreateSchema, creator_id: str):
    """
    Creates a meeting and simulates the 'Fairness Engine' finding slots.
    """
    req_id = f"m{uuid.uuid4().hex[:6]}"
    
    # 1. Create Meeting Request
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
    
    _put_item(f"MEET#{req_id}", "META", new_meeting.model_dump())
    
    # 2. Simulate slot generation logic (The "AI")
    # In reality, this would query all users' calendars and run the fairness algo.
    # Here we generate 2-3 random feasible slots.
    
    possible_hours = [10, 11, 13, 15, 16]
    num_slots = 3
    
    for i in range(num_slots):
        day_offset = random.randint(1, req_data.daysForward)
        hour = random.choice(possible_hours)
        minute = random.choice([0, 30])
        
        start_dt = datetime.now().replace(hour=hour, minute=minute, second=0, microsecond=0) + timedelta(days=day_offset)
        end_dt = start_dt + timedelta(minutes=req_data.durationMinutes)
        
        # Random fairness logic explanation
        score = random.randint(70, 99)
        impact = random.choice([-2, 0, 1, 3])
        explanations = [
            "Balanced for everyone's working hours",
            "Slightly inconvenient for user B, but high overall efficiency",
            "Perfect overlap with free time",
            "Minimizes context switching for the team"
        ]
        
        slot = SuggestedTimeSlot(
            requestId=req_id,
            startIso=start_dt,
            endIso=end_dt,
            score=float(score),
            fairnessImpact=float(impact),
            conflictCount=0,
            explanation=random.choice(explanations)
        )
        
        _put_item(f"MEET#{req_id}", f"SLOT#{start_dt.isoformat()}", slot.model_dump())

    return new_meeting
