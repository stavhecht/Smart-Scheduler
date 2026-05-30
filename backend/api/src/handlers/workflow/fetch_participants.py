"""
SFN State: FetchParticipantData

Input:  request_id, creator_id, participant_ids, date_range_start,
        date_range_end, duration_minutes, tz_offset_hours
Output: adds participant_states, participant_profiles

Retry / error handling is declared in the Step Functions state machine
definition — no try/except needed here.
"""
from src.database.repository import UserRepository

_user_repo = UserRepository()


def handler(payload: dict) -> dict:
    creator_id = payload.get("creator_id", "")
    participant_ids = payload.get("participant_ids", [])
    all_ids = list(set([creator_id] + participant_ids))

    participant_states = []
    participant_profiles = []

    for uid in all_ids:
        state = _user_repo.get_fairness(uid)
        if state:
            participant_states.append(state.model_dump(mode="json"))

        profile = _user_repo.get_profile_raw(uid)
        if profile:
            participant_profiles.append({
                "userId": uid,
                "displayName": profile.get("displayName", ""),
                "email": profile.get("email", ""),
                "timezone": profile.get("timezone", "UTC"),
                "workingHours": profile.get("workingHours", {"start": "09:00", "end": "18:00"}),
                "workingDays": profile.get("workingDays", [0, 1, 2, 3, 4]),
                "lunchBreak": profile.get("lunchBreak", {"start": "12:00", "duration": 60}),
            })

    payload["participant_states"] = participant_states
    payload["participant_profiles"] = participant_profiles
    return payload
