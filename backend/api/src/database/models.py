from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Decimal coercion — applied to every model that reads from DynamoDB
# ---------------------------------------------------------------------------

def _convert_decimals(obj: Any) -> Any:
    """Recursively convert DynamoDB Decimal values to int/float."""
    if isinstance(obj, Decimal):
        n = float(obj)
        return int(n) if n.is_integer() else n
    if isinstance(obj, dict):
        return {k: _convert_decimals(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_decimals(i) for i in obj]
    return obj


class BaseDBModel(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def convert_decimals(cls, data: Any) -> Any:
        return _convert_decimals(data) if isinstance(data, dict) else data


# ---------------------------------------------------------------------------
# Domain models
# ---------------------------------------------------------------------------

class UserProfile(BaseDBModel):
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
    workingDays: List[int] = [0, 1, 2, 3, 4]
    lunchBreak: Optional[Dict[str, Any]] = Field(
        default_factory=lambda: {"start": "12:00", "duration": 60}
    )
    notificationPrefs: Dict[str, bool] = Field(
        default_factory=lambda: {"invites": True, "reminders": True, "digest": False}
    )
    showFairnessScore: bool = True
    createdAt: datetime = Field(default_factory=datetime.now)


class ConnectedCalendar(BaseDBModel):
    provider: str
    email: str
    connectedAt: datetime = Field(default_factory=datetime.now)
    scopes: List[str] = []


class MeetingRequest(BaseDBModel):
    requestId: str
    creatorUserId: str
    participantUserIds: List[str]
    title: str
    description: Optional[str] = ""
    durationMinutes: int
    dateRangeStart: datetime
    dateRangeEnd: datetime
    status: str = "pending"
    selectedSlotStart: Optional[str] = None
    acceptedBy: List[str] = []
    declinedBy: List[str] = []
    createdAt: datetime = Field(default_factory=datetime.now)
    updatedAt: Optional[datetime] = None
    cancelledAt: Optional[datetime] = None
    cancelledBy: Optional[str] = None
    externalEventIds: Dict[str, str] = Field(default_factory=dict)
    # AI strategic summary — populated by SFN after slot generation; null if AI unavailable
    aiMeetingScore: Optional[float] = None
    aiSummary: Optional[str] = None
    aiBestSlotIso: Optional[str] = None
    aiBestSlotReason: Optional[str] = None
    aiCalendarSuggestions: List[str] = Field(default_factory=list)


class MeetingCreateSchema(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default="", max_length=2000)
    durationMinutes: int = Field(ge=15, le=480)
    participantIds: List[str] = []
    participantEmails: List[str] = []
    daysForward: int = Field(default=7, ge=1, le=90)


class MeetingEditSchema(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    durationMinutes: Optional[int] = None
    daysForward: Optional[int] = Field(default=None, ge=1, le=90)


class SuggestedTimeSlot(BaseDBModel):
    requestId: str
    startIso: datetime
    endIso: datetime
    score: float
    fairnessImpact: float
    conflictCount: int
    explanation: str
    aiScored: bool = False
    aiSuggestions: Optional[str] = None


class FairnessState(BaseDBModel):
    userId: str
    fairnessScore: float
    meetingLoadMetrics: Dict[str, Any]
    inconvenientMeetingsCount: int
    lastUpdatedAt: datetime = Field(default_factory=datetime.now)
    cancellation_timestamps: List[str] = Field(default_factory=list)
    prime_slots_accepted: int = 0
    lastWeekReset: Optional[str] = None


class MeetingLogEntry(BaseDBModel):
    requestId: str
    action: str
    by: str
    at: datetime = Field(default_factory=datetime.now)
    changes: Optional[Dict[str, Any]] = None


