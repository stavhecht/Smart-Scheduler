"""
SFN State: GenerateCandidateSlots

Input:  full payload from FetchParticipantData
Output: adds candidate_slots (list of {startIso, endIso, conflictCount})

Filters out hard creator conflicts and pre-computes per-slot conflict counts
so CalculateFairnessScores does not need to re-fetch calendar data.
"""
import logging
from datetime import datetime, timedelta
from typing import Dict

from src.common import calendar_client as _cc

from src.core.fairness import engine

logger = logging.getLogger(__name__)


def handler(payload: dict) -> dict:
    date_start = datetime.fromisoformat(payload["date_range_start"])
    date_end = datetime.fromisoformat(payload["date_range_end"])
    duration_minutes = payload.get("duration_minutes", 60)
    tz_offset = float(payload.get("tz_offset_hours", 0.0))
    creator_id = payload.get("creator_id", "")
    all_ids = list({creator_id} | set(payload.get("participant_ids", [])))

    # Per-meeting scheduling preferences — override profile-derived defaults when set
    preferred_hours = payload.get("preferred_hours")          # List[int] or None
    excluded_weekdays = set(payload.get("excluded_weekdays") or [])  # e.g. {0, 4}

    # Generate slots across the full day and all 7 days of the week.
    # preferred_hours becomes a soft score boost; excluded_weekdays is the only
    # hard day filter (explicit organizer exclusion). Participants' working-day
    # profiles affect scoring via REST_DAY_WEIGHT but not slot generation.
    FULL_DAY_HOURS = list(range(7, 22))
    wh_list = FULL_DAY_HOURS
    base_wd = list(range(7))  # all days; scoring penalises non-working days
    wd_list = [d for d in base_wd if d not in excluded_weekdays]

    candidates = engine.generate_candidate_slots(
        date_start, date_end,
        tz_offset_hours=tz_offset,
        working_hours=wh_list,
        working_days=wd_list,
    )
    end_delta = timedelta(minutes=duration_minutes)

    # Fetch calendar busy intervals for all participants (best-effort)
    all_busy: Dict[str, list] = {}
    for uid in all_ids:
        try:
            busy = _cc.get_user_busy_slots(uid, date_start, date_end)
            if busy:
                all_busy[uid] = busy
        except Exception as e:
            logger.warning(f"Calendar fetch failed for {uid}: {e}")

    def _conflict_count(slot_dt: datetime) -> int:
        slot_end = slot_dt + end_delta
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
    request_id = payload.get("request_id", "")
    try:
        from src.database.repository import MeetingRepository
        _mtg_repo = MeetingRepository()
        for m in _mtg_repo.get_user_meetings(creator_id):
            if (
                m.status == "confirmed"
                and m.selectedSlotStart
                and m.requestId != request_id
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
        logger.warning(f"[generate_slots] SS busy fetch failed for {creator_id}: {_exc}")

    # Hard-filter 1: remove slots where the creator has a conflict
    creator_busy = all_busy.get(creator_id, [])
    if creator_busy:
        def _creator_conflict(slot_dt: datetime) -> bool:
            slot_end = slot_dt + end_delta
            for b in creator_busy:
                try:
                    b_start = datetime.fromisoformat(b["start"].rstrip("Z"))
                    b_end = datetime.fromisoformat(b["end"].rstrip("Z"))
                    if slot_dt < b_end and slot_end > b_start:
                        return True
                except Exception:
                    pass
            return False
        candidates = [c for c in candidates if not _creator_conflict(c)]

    # Hard-filter 2: remove slots where the majority of participants conflict
    majority_threshold = len(all_ids) / 2
    candidate_slots = []
    for dt in candidates:
        cc = _conflict_count(dt)
        if cc <= majority_threshold:
            # Mark slots that fall within the user's preferred hours (organizer local time).
            # isPreferred=True when no preference was set (all slots equally preferred).
            local_hour = int((dt.hour + round(tz_offset)) % 24)
            is_preferred = preferred_hours is None or local_hour in preferred_hours
            candidate_slots.append({
                "startIso": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "endIso": (dt + end_delta).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "conflictCount": cc,
                "isPreferred": is_preferred,
            })
    payload["candidate_slots"] = candidate_slots
    return payload
