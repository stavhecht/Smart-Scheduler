from fastapi import FastAPI, HTTPException
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

@app.get("/api/profile", response_model=dict)
def get_user_profile():
    # Fetching for hardcoded user "u1" for demo purposes
    user_id = "u1"
    profile = db.get_profile(user_id)
    fairness = db.get_fairness_state(user_id)
    
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")

    # Extending the profile response to match Frontend expectations temporarily
    # The frontend expects flattened details for the "Score" display.
    return {
        "id": 1,
        "name": profile.displayName,
        "role": "Cloud Architect", 
        "fairness_score": fairness.fairnessScore if fairness else 50.0,
        "details": {
            "meetings_this_week": fairness.meetingLoadMetrics.get("meetings_this_week", 0) if fairness else 0,
            "cancellations_last_month": fairness.inconvenientMeetingsCount if fairness else 0,
            "suffering_score": int(fairness.fairnessScore / 10) if fairness else 0
        }
    }

@app.get("/api/meetings")
def get_meetings():
    """
    Returns all meeting requests with their suggested slots embedded.
    This is the rich data structure for the smart dashboard.
    """
    meetings = db.get_all_meetings()
    response_data = []
    
    for m in meetings:
        slots = db.get_meeting_slots(m.requestId)
        # Convert Pydantic models to dicts
        meeting_dict = m.model_dump()
        meeting_dict['slots'] = [s.model_dump() for s in slots]
        response_data.append(meeting_dict)
        
    return response_data

@app.post("/api/meetings/create")
def create_meeting(meeting_data: MeetingCreateSchema):
    """
    Creates a new meeting request and triggers the fairness engine simulation.
    """
    # Hardcoded current user
    user_id = "u1"
    new_meeting = db.create_meeting_with_simulation(meeting_data, user_id)
    return new_meeting

@app.post("/api/meetings/{request_id}/book/{slot_start_iso}")
def book_meeting_slot(request_id: str, slot_start_iso: str):
    # Logic to confirm a specific slot for a meeting
    meeting = db._get_item(f"MEET#{request_id}", "META")
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    # In a real app, we would verify the slot exists
    meeting['status'] = 'confirmed'
    meeting['selectedSlotStart'] = slot_start_iso
    
    # Simulate DB update
    db._put_item(f"MEET#{request_id}", "META", meeting)
    
    return {"status": "success", "message": "Meeting confirmed successfully", "meeting": meeting}

@app.get("/health")
def health():
    return {"status": "ok", "db": "DynamoDB Mock Active"}