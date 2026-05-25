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
        except Exception:
            pass

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

    # Build candidate slots with conflict counts (matches generate_slots.handler output)
    candidate_slots = []
    for slot_dt in candidates:
        end_dt = slot_dt + timedelta(minutes=meeting.durationMinutes)
        candidate_slots.append({
            "startIso": slot_dt.isoformat() + "Z",
            "endIso": end_dt.isoformat() + "Z",
            "conflictCount": _conflict_count(slot_dt),
        })

    # Trim per-user busy intervals (matches generate_slots payload shape)
    participant_busy_payload = {
        uid: [{"start": b.get("start", ""), "end": b.get("end", "")} for b in busy_list[:50]]
        for uid, busy_list in all_busy.items()
    }

    # Run the AI-first calculate_fairness handler — keeps local dev in sync with SFN path
    from src.handlers.workflow import calculate_fairness
    cf_payload = calculate_fairness.handler({
        "participant_profiles": participant_profiles,
        "participant_states": participant_states,
        "candidate_slots": candidate_slots,
        "participant_busy": participant_busy_payload,
        "duration_minutes": meeting.durationMinutes,
        "tz_offset_hours": tz_offset,
    })
    all_scored = cf_payload["scored_slots"]
    ai_summary = cf_payload.get("ai_summary")

    days_forward = max(1, (meeting.dateRangeEnd - meeting.dateRangeStart).days)
    slot_count = min(30, max(8, days_forward * 3))
    best_slots = engine.reshuffle(all_scored, count=slot_count) if engine.needs_optimization(all_scored) else engine.select_best_slots(all_scored, count=slot_count)

    for slot_data in best_slots:
        slot = models.SuggestedTimeSlot(
            requestId=meeting.requestId,
            startIso=datetime.fromisoformat(slot_data["startIso"]),
            endIso=datetime.fromisoformat(slot_data["endIso"]),
            score=float(slot_data["score"]),
            fairnessImpact=float(slot_data["fairnessImpact"]),
            conflictCount=slot_data.get("conflictCount", 0),
            explanation=slot_data["explanation"],
            aiScored=bool(slot_data.get("aiScored", False)),
            aiSuggestions=slot_data.get("aiSuggestions"),
        )
        _meeting_repo.write_slot(
            meeting.requestId,
            slot.startIso.isoformat(),
            slot.model_dump(mode="json"),
        )

    # Persist meeting-wide AI summary the same way store_results does in the SFN path
    if ai_summary:
        try:
            meta = _meeting_repo.get_meta(meeting.requestId)
            if meta:
                meta.update({
                    "aiMeetingScore": float(ai_summary.get("meetingScore", 0.0)),
                    "aiSummary": str(ai_summary.get("summary", ""))[:300],
                    "aiBestSlotIso": str(ai_summary.get("bestSlotIso", "")),
                    "aiBestSlotReason": str(ai_summary.get("bestSlotReason", ""))[:600],
                    "aiCalendarSuggestions": list(ai_summary.get("calendarSuggestions", []))[:4],
                })
                _meeting_repo.update_meta(meeting.requestId, meta)
        except Exception as e:
            logger.warning(f"local_sim: failed to persist AI summary: {e}")

    return meeting
