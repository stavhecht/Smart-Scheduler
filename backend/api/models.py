from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta

# --- 1. User Profile ---
class UserProfile(BaseModel):
    userId: str
    email: str
    displayName: str
    bio: Optional[str] = ""
    role: Optional[str] = "Professional"
    department: Optional[str] = "General"
    skills: List[str] = []
    statusMessage: Optional[str] = "Focused & Ready"
    timezone: str = "Asia/Jerusalem"
    workingHours: Dict[str, str] = {"start": "09:00", "end": "18:00"}
    createdAt: datetime = Field(default_factory=datetime.now)

# --- 2. Connected Calendar (OAuth tokens stored separately in DB) ---
class ConnectedCalendar(BaseModel):
    provider: str          # "google" | "microsoft"
    email: str             # calendar account email
    connectedAt: datetime = Field(default_factory=datetime.now)
    scopes: List[str] = []

# --- 3. Meeting Request ---
class MeetingRequest(BaseModel):
    requestId: str
    creatorUserId: str
    participantUserIds: List[str]
    title: str
    durationMinutes: int
    dateRangeStart: datetime
    dateRangeEnd: datetime
    status: str = "pending"          # pending | confirmed | cancelled
    selectedSlotStart: Optional[str] = None   # ISO string of booked slot
    acceptedBy: List[str] = []               # user IDs who accepted
    createdAt: datetime = Field(default_factory=datetime.now)
    updatedAt: Optional[datetime] = None
    cancelledAt: Optional[datetime] = None
    cancelledBy: Optional[str] = None
    externalEventIds: Dict[str, str] = Field(default_factory=dict)    # mapping of userId: "provider:eventId"

# --- Input Models ---
class MeetingCreateSchema(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    durationMinutes: int = Field(ge=15, le=480)
    participantIds: List[str] = []
    participantEmails: List[str] = []   # invite by email
    daysForward: int = Field(default=7, ge=1, le=90)

class MeetingEditSchema(BaseModel):
    title: Optional[str] = None
    durationMinutes: Optional[int] = None

# --- 4. Suggested Time Slot ---
class SuggestedTimeSlot(BaseModel):
    requestId: str
    startIso: datetime
    endIso: datetime
    score: float
    fairnessImpact: float
    conflictCount: int
    explanation: str

# --- 5. Fairness State ---
class FairnessState(BaseModel):
    userId: str
    fairnessScore: float
    meetingLoadMetrics: Dict[str, int]   # {"meetings_this_week": 3, ...}
    inconvenientMeetingsCount: int
    lastUpdatedAt: datetime = Field(default_factory=datetime.now)

# --- 6. Meeting Activity Log Entry ---
class MeetingLogEntry(BaseModel):
    requestId: str
    action: str        # created | edited | cancelled | rescheduled | booked | accepted
    by: str            # userId
    at: datetime = Field(default_factory=datetime.now)
    changes: Optional[Dict[str, Any]] = None   # for "edited" entries

# --- 7. Profile Message (Direct communication) ---
class ProfileMessage(BaseModel):
    messageId: str
    fromUserId: str
    toUserId: str
    fromDisplayName: str = ""
    content: str
    messageType: str = "general"  # general | kudos | nudge
    createdAt: datetime = Field(default_factory=datetime.now)
    isRead: bool = False
