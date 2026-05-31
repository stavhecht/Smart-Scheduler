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
from src.database.repository import MeetingRepository, UserRepository

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

    participant_tz_offsets    = [get_tz_offset_hours(p.get("timezone", "UTC")) for p in participant_profiles] or None
    participant_working_days  = [p.get("workingDays", list(range(7))) for p in participant_profiles] or None
    participant_lunch_breaks  = [p.get("lunchBreak") for p in participant_profiles] or None

    preferred_hours = getattr(meeting_data, "preferredHours", None)
    excluded_weekdays = set(getattr(meeting_data, "excludedWeekdays", None) or [])

    FULL_DAY_HOURS = list(range(7, 22))
    wh_list = FULL_DAY_HOURS
    base_wd = list(range(7))  # all days; scoring penalises non-working days
    wd_list = [d for d in base_wd if d not in excluded_weekdays]

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

    # Supplement creator busy with confirmed Smart Scheduler meetings (covers users
    # without a connected external calendar so their accepted meetings are also filtered).
    try:
        for m in _meeting_repo.get_user_meetings(creator_id):
            if (
                m.status == "confirmed"
                and m.selectedSlotStart
                and m.requestId != meeting.requestId
            ):
                try:
                    s = datetime.fromisoformat(m.selectedSlotStart.rstrip("Z"))
                    e = s + timedelta(minutes=int(m.durationMinutes or 60))
                    all_busy.setdefault(creator_id, []).append(
                        {"start": s.isoformat(), "end": e.isoformat()}
                    )
                except Exception:
                    pass
    except Exception as _exc:
        logger.warning(f"[local_sim] SS busy fetch failed for {creator_id}: {_exc}")

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

    # Build candidate slots; skip any slot where the majority of participants conflict
    majority_threshold = len(all_pids) / 2
    candidate_slots = []
    for slot_dt in candidates:
        cc = _conflict_count(slot_dt)
        if cc <= majority_threshold:
            local_hour = int((slot_dt.hour + round(tz_offset)) % 24)
            is_preferred = preferred_hours is None or local_hour in preferred_hours
            end_dt = slot_dt + timedelta(minutes=meeting.durationMinutes)
            candidate_slots.append({
                "startIso": slot_dt.isoformat() + "Z",
                "endIso": end_dt.isoformat() + "Z",
                "conflictCount": cc,
                "isPreferred": is_preferred,
            })

    # Run the heuristic calculate_fairness handler — keeps local dev in sync with SFN path.
    # AI scoring runs later via `_run_ai_inline`.
    from src.handlers.workflow import calculate_fairness
    cf_payload = calculate_fairness.handler({
        "participant_profiles": participant_profiles,
        "participant_states": participant_states,
        "candidate_slots": candidate_slots,
        "duration_minutes": meeting.durationMinutes,
        "tz_offset_hours": tz_offset,
        "participant_tz_offsets": participant_tz_offsets,
        "participant_working_days": participant_working_days,
        "participant_lunch_breaks": participant_lunch_breaks,
        "preferred_hours": preferred_hours,
    })
    all_scored = cf_payload["scored_slots"]

    days_forward = max(1, (meeting.dateRangeEnd - meeting.dateRangeStart).days)
    slot_count = min(50, max(10, days_forward * 4))
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
            aiScored=bool(slot_data.get("aiScored", False)),
            aiSuggestions=slot_data.get("aiSuggestions"),
            isPreferred=bool(slot_data.get("isPreferred", False)),
        )
        _meeting_repo.write_slot(
            meeting.requestId,
            slot.startIso.isoformat(),
            slot.model_dump(mode="json"),
        )

    return meeting
