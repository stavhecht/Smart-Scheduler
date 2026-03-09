from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from models import UserProfile, MeetingRequest, SuggestedTimeSlot, FairnessState, MeetingCreateSchema
import db
from mangum import Mangum

app = FastAPI()
handler = Mangum(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Identity helpers
# ---------------------------------------------------------------------------

def get_current_user(request: Request) -> dict:
    """
    Extracts the authenticated user's identity from the Cognito JWT claims.

    API Gateway v2 (HTTP API) injects the JWT claims into the Lambda event
    at: event.requestContext.authorizer.jwt.claims

    Mangum makes the raw Lambda event available via request.scope["aws.event"].

    Returns a dict with keys: user_id, email, display_name
    Falls back to a local-dev default if no claims are found (useful for
    running the backend locally without AWS auth).
    """
    event = request.scope.get("aws.event", {})
    try:
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        user_id = claims.get("sub", "anonymous")
        email = claims.get("email", f"{user_id}@example.com")
        # Cognito stores the preferred username in "cognito:username"
        display_name = claims.get("name") or claims.get("cognito:username") or email.split("@")[0]
        return {"user_id": user_id, "email": email, "display_name": display_name}
    except (KeyError, TypeError):
        # Local development fallback – no JWT present
        return {"user_id": "u1", "email": "dev@localhost", "display_name": "Dev User"}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/profile", response_model=dict)
def get_user_profile(request: Request):
    identity = get_current_user(request)
    user_id = identity["user_id"]

    # Auto-create profile if this is the user's very first login
    db.ensure_user_profile(user_id, identity["email"], identity["display_name"])

    profile = db.get_profile(user_id)
    fairness = db.get_fairness_state(user_id)

    if not profile:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": user_id,
        "name": profile.displayName,
        "role": "Cloud Architect",
        "fairness_score": fairness.fairnessScore if fairness else 50.0,
        "details": {
            "meetings_this_week": fairness.meetingLoadMetrics.get("meetings_this_week", 0) if fairness else 0,
            "cancellations_last_month": fairness.inconvenientMeetingsCount if fairness else 0,
            "suffering_score": int(fairness.fairnessScore / 10) if fairness else 0,
        }
    }


@app.get("/api/meetings")
def get_meetings(request: Request):
    """
    Returns all meeting requests created by the authenticated user,
    with their suggested slots embedded.
    """
    identity = get_current_user(request)
    user_id = identity["user_id"]

    meetings = db.get_user_meetings(user_id)
    response_data = []

    for m in meetings:
        slots = db.get_meeting_slots(m.requestId)
        meeting_dict = m.model_dump()
        meeting_dict['slots'] = [s.model_dump() for s in slots]
        response_data.append(meeting_dict)

    return response_data


@app.post("/api/meetings/create")
def create_meeting(meeting_data: MeetingCreateSchema, request: Request):
    """
    Creates a new meeting request and triggers the fairness engine simulation.
    The creator is the authenticated user, not a hardcoded ID.
    """
    identity = get_current_user(request)
    user_id = identity["user_id"]
    new_meeting = db.create_meeting_with_simulation(meeting_data, user_id)
    return new_meeting


@app.post("/api/meetings/{request_id}/book/{slot_start_iso}")
def book_meeting_slot(request_id: str, slot_start_iso: str, request: Request):
    identity = get_current_user(request)

    meeting = db._get_item(f"MEET#{request_id}", "META")
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Confirm the selected slot
    meeting['status'] = 'confirmed'
    meeting['selectedSlotStart'] = slot_start_iso
    db._put_item(f"MEET#{request_id}", "META", meeting)

    return {"status": "success", "message": "Meeting confirmed successfully", "meeting": meeting}


@app.get("/health")
def health():
    return {"status": "ok", "db": "DynamoDB Active"}