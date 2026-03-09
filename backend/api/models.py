from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime, timedelta

# --- 1. User Profile ---
class UserProfile(BaseModel):
    userId: str
    email: str
    displayName: str
    timezone: str = "Asia/Jerusalem"
    workingHours: Dict[str, str] = {"start": "09:00", "end": "17:00"}
    createdAt: datetime = Field(default_factory=datetime.now)

# --- 2. Connected Calendar ---
class ConnectedCalendar(BaseModel):
    provider: str  # google, microsoft
    accountId: str
    scopes: List[str]
    connectedAt: datetime = Field(default_factory=datetime.now)

# --- 3. Meeting Request ---
class MeetingRequest(BaseModel):
    requestId: str
    creatorUserId: str
    participantUserIds: List[str]
    title: str
    durationMinutes: int
    dateRangeStart: datetime
    dateRangeEnd: datetime
    status: str = "pending"  # pending, confirmed, cancelled
    selectedSlotStart: Optional[str] = None  # ISO string of booked slot
    acceptedBy: List[str] = []              # user IDs who accepted
    createdAt: datetime = Field(default_factory=datetime.now)

# --- Input Model for Creation ---
class MeetingCreateSchema(BaseModel):
    title: str
    durationMinutes: int
    participantIds: List[str] = []
    participantEmails: List[str] = []  # invite by email
    daysForward: int = 3

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
    meetingLoadMetrics: Dict[str, int]  # e.g., {"weekly_hours": 5}
    inconvenientMeetingsCount: int
    lastUpdatedAt: datetime = Field(default_factory=datetime.now)
