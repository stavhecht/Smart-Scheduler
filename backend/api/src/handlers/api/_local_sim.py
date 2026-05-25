"""
Full in-process scheduling simulation used in local dev (no AWS_ACCOUNT_ID).
Mirrors the Step Functions workflow but runs synchronously inside the Lambda.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Dict

from src.common import calendar_client as _cc
from src.common.timezone import get_tz_offset_hours
from src.core.fairness import engine
from src.database import models
from src.database.repository import (
    MeetingRepository,
    UserRepository,
    get_working_days_intersection,
    get_working_hours_list,
)

logger = logging.getLogger(__name__)

_meeting_repo = MeetingRepository()
_user_repo = UserRepository()


def run_simulation(
    meeting_data: models.MeetingCreateSchema, creator_id: str
) -> models.MeetingRequest:
    meeting = _meeting_repo.create_record(meeting_data, creator_id)
    all_pids = list(set([creator_id] + (meeting_data.participantIds or [])))

    participant_states = []
    participant_profiles = []
    for uid in all_pids:
        state = _user_repo.get_fairness(uid)
        if state:
            participant_states.append(state.model_dump(mode="json"))
        profile = _user_repo.get_profile_raw(uid)
        if profile:
            participant_profiles.append(profile)

    creator_profile = next((p for p in participant_profiles if p.get("userId") == creator_id), None)
    creator_tz = (creator_profile or {}).get("timezone", "UTC")
    tz_offset = get_tz_offset_hours(creator_tz)

    participant_tz_offsets = [get_tz_offset_hours(p.get("timezone", "UTC")) for p in participant_profiles] or None
    participant_working_days = [p.get("workingDays", list(range(7))) for p in participant_profiles] or None
    participant_lunch_breaks = [p.get("lunchBreak") for p in participant_profiles] or None

    wh_list = get_working_hours_list(participant_profiles)
    wd_list = get_working_days_intersection(participant_profiles)

    candidates = engine.generate_candidate_slots(
        meeting.dateRangeStart, meeting.dateRangeEnd,
        tz_offset_hours=tz_offset, working_hours=wh_list, working_days=wd_list,
    )

    all_busy: Dict[str, list] = {}
    for uid in all_pids:
        try:
            busy = _cc.get_user_busy_slots(uid, meeting.dateRangeStart, meeting.dateRangeEnd)
            if busy:
                all_busy[uid] = busy
        except Exception as e:
            logger.warning(f"Calendar fetch failed for {uid}: {e}")

    def _conflict_count(slot_dt: datetime) -> int:
        slot_end = slot_dt + timedelta(minutes=meeting.durationMinutes)
        count = 0
        for uid, busy_list in all_busy.items():
            for b in busy_list:
                try:
                    b_start = datetime.fromisoformat(b["start"].rstrip("Z"))
                    b_end = datetime.fromisoformat(b["end"].rstrip("Z"))
                    if slot_dt < b_end and slot_end > b_start:
                        count += 1
                        break
                except Exception:
                    pass
        return count

    creator_busy = all_busy.get(creator_id, [])
    if creator_busy:
        def _creator_conflicts(slot_dt: datetime) -> bool:
            slot_end = slot_dt + timedelta(minutes=meeting.durationMinutes)
            for b in creator_busy:
                try:
                    b_start = datetime.fromisoformat(b["start"].rstrip("Z"))
                    b_end = datetime.fromisoformat(b["end"].rstrip("Z"))
                    if slot_dt < b_end and slot_end > b_start:
                        return True
                except Exception:
                    pass
            return False
        candidates = [c for c in candidates if not _creator_conflicts(c)]

    all_scored = []
    for slot_dt in candidates:
        busy_count = _conflict_count(slot_dt)
        result = engine.score_time_slot(
            slot_dt, participant_states, meeting.durationMinutes,
            tz_offset_hours=tz_offset,
            participant_tz_offsets=participant_tz_offsets,
            participant_working_days=participant_working_days,
            participant_lunch_breaks=participant_lunch_breaks,
            busy_count=busy_count,
        )
        end_dt = slot_dt + timedelta(minutes=meeting.durationMinutes)
        all_scored.append({"startIso": slot_dt.strftime("%Y-%m-%dT%H:%M:%SZ"), "endIso": end_dt.strftime("%Y-%m-%dT%H:%M:%SZ"), **result})

    days_forward = max(1, (meeting.dateRangeEnd - meeting.dateRangeStart).days)
    slot_count = min(30, max(8, days_forward * 3))
    best_slots = engine.reshuffle(all_scored, count=slot_count) if engine.needs_optimization(all_scored) else engine.select_best_slots(all_scored, count=slot_count)

    for slot_data in best_slots:
        slot = models.SuggestedTimeSlot(
            requestId=meeting.requestId,
            startIso=datetime.fromisoformat(slot_data["startIso"].replace("Z", "+00:00")),
            endIso=datetime.fromisoformat(slot_data["endIso"].replace("Z", "+00:00")),
            score=float(slot_data["score"]),
            fairnessImpact=float(slot_data["fairnessImpact"]),
            conflictCount=slot_data.get("conflictCount", 0),
            explanation=slot_data["explanation"],
        )
        _meeting_repo.write_slot(
            meeting.requestId,
            slot.startIso.isoformat(),
            slot.model_dump(mode="json"),
        )

    return meeting
