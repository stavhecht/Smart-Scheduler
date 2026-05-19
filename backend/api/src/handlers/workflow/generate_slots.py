"""
SFN State: GenerateCandidateSlots

Input:  full payload from FetchParticipantData
Output: adds candidate_slots (list of {startIso, endIso, conflictCount})

Filters out hard creator conflicts and pre-computes per-slot conflict counts
so CalculateFairnessScores does not need to re-fetch calendar data.
"""
from datetime import datetime, timedelta
from typing import Dict

from src.common import calendar_client as _cc

from src.core.fairness import engine
from src.database.repository import get_working_days_intersection, get_working_hours_list


def handler(payload: dict) -> dict:
    date_start = datetime.fromisoformat(payload["date_range_start"])
    date_end = datetime.fromisoformat(payload["date_range_end"])
    duration_minutes = payload.get("duration_minutes", 60)
    tz_offset = float(payload.get("tz_offset_hours", 0.0))
    profiles = payload.get("participant_profiles", [])
    creator_id = payload.get("creator_id", "")
    all_ids = list({creator_id} | set(payload.get("participant_ids", [])))

    wh_list = get_working_hours_list(profiles)
    wd_list = get_working_days_intersection(profiles)

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
        except Exception:
            pass

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

    # Remove slots where the creator has a hard conflict
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

    payload["candidate_slots"] = [
        {
            "startIso": dt.isoformat() + "Z",
            "endIso": (dt + end_delta).isoformat() + "Z",
            "conflictCount": _conflict_count(dt),
        }
        for dt in candidates
    ]
    return payload
