from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError
from fastapi import HTTPException

from src.common.dynamo import get_db
from src.common.timezone import get_tz_offset_hours
from src.database import models


# ---------------------------------------------------------------------------
# Working hours / day helpers (previously in db.py)
# ---------------------------------------------------------------------------

def get_working_hours_list(participant_profiles: List[dict]) -> List[int]:
    """Intersection of participants' working hours, skipping personal lunch hours."""
    from src.core.fairness import engine
    if not participant_profiles:
        return engine.WORKING_HOURS
    try:
        starts = [
            int(p.get("workingHours", {}).get("start", "09:00").split(":")[0])
            for p in participant_profiles
        ]
        ends = [
            int(p.get("workingHours", {}).get("end", "18:00").split(":")[0])
            for p in participant_profiles
        ]
        lunch_hours: set = set()
        for p in participant_profiles:
            lb = p.get("lunchBreak") or {}
            try:
                start_h = int(str(lb.get("start", "12:00")).split(":")[0])
                dur = int(lb.get("duration", 60))
                for h in range(start_h, start_h + max(1, dur // 60)):
                    lunch_hours.add(h)
            except (ValueError, TypeError):
                lunch_hours.add(12)
        wh_start = max(starts)
        wh_end = min(ends)
        if wh_start >= wh_end:
            return engine.WORKING_HOURS
        hours = [h for h in range(max(7, wh_start), min(19, wh_end)) if h not in lunch_hours]
        return hours if hours else engine.WORKING_HOURS
    except Exception:
        from src.core.fairness import engine as _e
        return _e.WORKING_HOURS


def get_working_days_intersection(participant_profiles: List[dict]) -> List[int]:
    """Intersection of participants' working days."""
    if not participant_profiles:
        return [0, 1, 2, 3, 4]
    try:
        common = set(range(7))
        for p in participant_profiles:
            common &= set(p.get("workingDays", [0, 1, 2, 3, 4]))
        return sorted(common) if common else [0, 1, 2, 3, 4]
    except Exception:
        return [0, 1, 2, 3, 4]


# ---------------------------------------------------------------------------
# UserRepository
# ---------------------------------------------------------------------------

class UserRepository:
    def __init__(self) -> None:
        self._db = get_db()

    def ensure_profile(self, user_id: str, email: str, display_name: str) -> None:
        if self._db.get(f"USER#{user_id}", "PROFILE"):
            return
        self._db.put(
            f"USER#{user_id}", "PROFILE",
            models.UserProfile(
                userId=user_id, email=email, displayName=display_name,
                timezone="Asia/Jerusalem",
                workingHours={"start": "09:00", "end": "18:00"},
                workingDays=[0, 1, 2, 3, 4],
            ).model_dump(mode="json"),
        )
        self._db.put(
            f"USER#{user_id}", "FAIRNESS",
            models.FairnessState(
                userId=user_id, fairnessScore=100.0,
                meetingLoadMetrics={"meetings_this_week": 0, "cancellations_last_month": 0, "suffering_score": 0},
                inconvenientMeetingsCount=0,
            ).model_dump(mode="json"),
        )

    def get_profile(self, user_id: str) -> Optional[models.UserProfile]:
        data = self._db.get(f"USER#{user_id}", "PROFILE")
        return models.UserProfile(**data) if data else None

    def get_profile_raw(self, user_id: str) -> Optional[dict]:
        return self._db.get(f"USER#{user_id}", "PROFILE")

    def update_profile(self, user_id: str, updates: dict) -> Optional[models.UserProfile]:
        data = self._db.get(f"USER#{user_id}", "PROFILE")
        if not data:
            return None
        for k, v in updates.items():
            if k in models.UserProfile.model_fields and v is not None:
                data[k] = v
        self._db.put(f"USER#{user_id}", "PROFILE", data)
        return models.UserProfile(**data)

    def get_fairness(self, user_id: str) -> Optional[models.FairnessState]:
        data = self._db.get(f"USER#{user_id}", "FAIRNESS")
        return models.FairnessState(**data) if data else None

    def update_fairness_on_booking(self, user_ids: List[str], fairness_impact: float) -> None:
        from src.core.fairness import engine
        for uid in user_ids:
            fairness = self.get_fairness(uid)
            if not fairness:
                self.ensure_profile(uid, "", uid[:8])
                fairness = self.get_fairness(uid)
            if not fairness:
                continue
            updated = engine.update_score_after_booking(
                {"fairnessScore": float(fairness.fairnessScore),
                 "meetingLoadMetrics": fairness.meetingLoadMetrics},
                fairness_impact,
            )
            self._db.put(f"USER#{uid}", "FAIRNESS", {
                "userId": uid,
                **updated,
                "inconvenientMeetingsCount": (
                    fairness.inconvenientMeetingsCount + updated["inconvenientMeetingsCount"]
                ),
                "lastUpdatedAt": datetime.now().isoformat(),
            })

    def has_oauth_tokens(self, user_id: str, provider: str) -> bool:
        return bool(self._db.get(f"USER#{user_id}", f"OAUTH#{provider}"))

    def get_by_emails(self, emails: List[str]) -> List[dict]:
        normalised = {e.strip().lower() for e in emails if e.strip()}
        if not normalised:
            return []
        all_profiles = self._db.scan(FilterExpression=Attr("SK").eq("PROFILE"))
        return [p for p in all_profiles if p.get("email", "").lower() in normalised]

    def get_by_ids(self, user_ids: List[str]) -> Dict[str, dict]:
        result: Dict[str, dict] = {}
        for uid in user_ids:
            profile = self._db.get(f"USER#{uid}", "PROFILE")
            result[uid] = (
                {"name": profile.get("displayName", uid[:8] + "..."), "email": profile.get("email", "")}
                if profile
                else {"name": uid[:8] + "...", "email": ""}
            )
        return result

    def get_all_users(self, exclude_user_id: str) -> list:
        all_profiles = self._db.scan(FilterExpression=Attr("SK").eq("PROFILE"))
        result = []
        for p in all_profiles:
            uid = p.get("userId", "")
            if uid and uid != exclude_user_id:
                fairness = self._db.get(f"USER#{uid}", "FAIRNESS")
                p["fairness_score"] = float(fairness.get("fairnessScore", 100)) if fairness else 100.0
                result.append(p)
            if len(result) >= 50:
                break
        return result

    def get_shared_meetings(self, user_a_id: str, user_b_id: str) -> dict:
        a_parts = {
            item.get("meetingId")
            for item in self._db.query_prefix(f"USER#{user_a_id}", "PART#")
            if item.get("meetingId")
        }
        b_parts = {
            item.get("meetingId")
            for item in self._db.query_prefix(f"USER#{user_b_id}", "PART#")
            if item.get("meetingId")
        }
        shared_ids = a_parts & b_parts
        recent_titles = []
        for mid in list(shared_ids)[:5]:
            m = self._db.get(f"MEET#{mid}", "META")
            if m and m.get("status") == "confirmed":
                recent_titles.append(m.get("title", ""))
        return {"count": len(shared_ids), "recentTitles": recent_titles[:3]}

    def send_message(
        self, from_uid: str, to_uid: str, content: str, msg_type: str = "general"
    ) -> models.ProfileMessage:
        from_profile = self.get_profile(from_uid)
        from_name = from_profile.displayName if from_profile else from_uid[:8]
        msg_id = f"msg_{uuid.uuid4().hex[:8]}"
        msg = models.ProfileMessage(
            messageId=msg_id, fromUserId=from_uid, toUserId=to_uid,
            fromDisplayName=from_name, content=content, messageType=msg_type,
        )
        self._db.put(
            f"USER#{to_uid}",
            f"MSG#{msg.createdAt.isoformat()}#{msg_id}",
            msg.model_dump(mode="json"),
        )
        return msg

    def get_messages(self, user_id: str, limit: int = 20) -> List[models.ProfileMessage]:
        items = self._db.query_prefix(f"USER#{user_id}", "MSG#")
        msgs = []
        for item in items:
            try:
                msgs.append(models.ProfileMessage(**item))
            except Exception:
                pass
        msgs.sort(key=lambda x: x.createdAt, reverse=True)
        return msgs[:limit]

    def mark_messages_read(self, user_id: str) -> None:
        items = self._db.query_prefix(f"USER#{user_id}", "MSG#")
        for item in items:
            if not item.get("isRead", False):
                sk = item.get("SK", "")
                if sk:
                    try:
                        self._db.table.update_item(
                            Key={"PK": f"USER#{user_id}", "SK": sk},
                            UpdateExpression="SET isRead = :r",
                            ExpressionAttributeValues={":r": True},
                        )
                    except Exception:
                        pass

    def get_stats(self, user_id: str, meetings: List[models.MeetingRequest]) -> dict:
        total_organised = sum(1 for m in meetings if m.creatorUserId == user_id)
        total_accepted = sum(1 for m in meetings if m.status == "confirmed")
        total_cancelled = sum(1 for m in meetings if m.status == "cancelled")
        fairness_item = self._db.get(f"USER#{user_id}", "FAIRNESS")
        current_score = float(fairness_item.get("fairnessScore", 100)) if fairness_item else 100.0
        load_metrics = (fairness_item or {}).get("meetingLoadMetrics", {})
        return {
            "total_organized": total_organised,
            "total_accepted": total_accepted,
            "total_cancelled": total_cancelled,
            "current_fairness_score": round(current_score, 1),
            "meetings_this_week": int(float(load_metrics.get("meetings_this_week", 0))),
            "suffering_score": int(float(load_metrics.get("suffering_score", 0))),
        }

    def get_recent_activity(self, user_id: str, limit: int = 12) -> List[dict]:
        part_items = self._db.query_prefix(f"USER#{user_id}", "PART#")
        meeting_ids = [item.get("meetingId") for item in part_items if item.get("meetingId")]
        meeting_ids = meeting_ids[:20]
        all_logs: List[dict] = []
        for mid in meeting_ids:
            meeting = self._db.get(f"MEET#{mid}", "META")
            if not meeting:
                continue
            meeting_title = meeting.get("title", "Meeting")
            log_items = self._db.query_prefix(f"MEET#{mid}", "LOG#")
            for log in log_items:
                all_logs.append({
                    "meetingId": mid,
                    "meetingTitle": meeting_title,
                    "action": log.get("action", ""),
                    "by": log.get("by", ""),
                    "at": log.get("at", ""),
                })
        all_logs.sort(key=lambda x: x.get("at", ""), reverse=True)
        return all_logs[:limit]


# ---------------------------------------------------------------------------
# MeetingRepository
# ---------------------------------------------------------------------------

class MeetingRepository:
    def __init__(self) -> None:
        self._db = get_db()

    def get_meta(self, request_id: str) -> Optional[dict]:
        return self._db.get(f"MEET#{request_id}", "META")

    def update_meta(self, request_id: str, data: dict) -> None:
        self._db.put(f"MEET#{request_id}", "META", data)

    def create_record(
        self, req_data: models.MeetingCreateSchema, creator_id: str
    ) -> models.MeetingRequest:
        req_id = f"m{uuid.uuid4().hex[:6]}"
        meeting = models.MeetingRequest(
            requestId=req_id,
            creatorUserId=creator_id,
            participantUserIds=req_data.participantIds,
            title=req_data.title,
            description=getattr(req_data, "description", "") or "",
            durationMinutes=req_data.durationMinutes,
            dateRangeStart=datetime.now(),
            dateRangeEnd=datetime.now() + timedelta(days=req_data.daysForward),
            status="pending",
        )
        self._db.put(f"MEET#{req_id}", "META", meeting.model_dump(mode="json"))
        self._write_participation_records(meeting)
        return meeting

    def _write_participation_records(self, meeting: models.MeetingRequest) -> None:
        all_ids = list(set([meeting.creatorUserId] + (meeting.participantUserIds or [])))
        for uid in all_ids:
            if uid:
                self._db.put(f"USER#{uid}", f"PART#{meeting.requestId}", {
                    "meetingId": meeting.requestId,
                    "role": "creator" if uid == meeting.creatorUserId else "participant",
                    "addedAt": datetime.now().isoformat(),
                })

    def get_slot(self, request_id: str, slot_start_iso: str) -> Optional[dict]:
        return self._db.get(f"MEET#{request_id}", f"SLOT#{slot_start_iso}")

    def get_slots(self, request_id: str) -> List[models.SuggestedTimeSlot]:
        items = self._db.query_prefix(f"MEET#{request_id}", "SLOT#")
        slots = []
        for item in items:
            try:
                slots.append(models.SuggestedTimeSlot(**item))
            except Exception:
                pass
        slots.sort(key=lambda x: x.score, reverse=True)
        return slots

    def write_slot(self, request_id: str, slot_start_iso: str, slot_dict: dict) -> None:
        self._db.put(f"MEET#{request_id}", f"SLOT#{slot_start_iso}", slot_dict)

    def delete_slots(self, request_id: str) -> None:
        slots = self._db.query_prefix(f"MEET#{request_id}", "SLOT#")
        with self._db.table.batch_writer() as batch:
            for s in slots:
                batch.delete_item(Key={"PK": s["PK"], "SK": s["SK"]})

    def confirm_slot(self, request_id: str, slot_start_iso: str) -> None:
        """Conditional write — raises HTTP 409 if slot already confirmed."""
        try:
            self._db.table.update_item(
                Key={"PK": f"MEET#{request_id}", "SK": "META"},
                UpdateExpression="SET #st = :confirmed, selectedSlotStart = :slot, updatedAt = :now",
                ConditionExpression="attribute_not_exists(selectedSlotStart) OR #st = :pending",
                ExpressionAttributeNames={"#st": "status"},
                ExpressionAttributeValues={
                    ":confirmed": "confirmed",
                    ":slot": slot_start_iso,
                    ":now": datetime.now().isoformat(),
                    ":pending": "pending",
                },
            )
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise HTTPException(
                    status_code=409,
                    detail="This slot was just taken by someone else — please refresh and choose another",
                )
            raise

    def cancel(self, request_id: str, cancelled_by: str) -> Optional[dict]:
        meeting = self.get_meta(request_id)
        if not meeting:
            return None
        now = datetime.now().isoformat()
        meeting.update({
            "status": "cancelled",
            "cancelledAt": now,
            "cancelledBy": cancelled_by,
            "updatedAt": now,
        })
        self.update_meta(request_id, meeting)
        self.log_activity(request_id, "cancelled", cancelled_by)
        return meeting

    def edit(
        self,
        request_id: str,
        edited_by: str,
        title: Optional[str] = None,
        duration_minutes: Optional[int] = None,
        description: Optional[str] = None,
    ) -> Optional[dict]:
        meeting = self.get_meta(request_id)
        if not meeting:
            return None
        changes: dict = {}
        if title is not None and title != meeting.get("title"):
            changes["title"] = {"from": meeting.get("title"), "to": title}
            meeting["title"] = title
        if duration_minutes is not None and duration_minutes != meeting.get("durationMinutes"):
            changes["durationMinutes"] = {"from": meeting.get("durationMinutes"), "to": duration_minutes}
            meeting["durationMinutes"] = duration_minutes
        if description is not None and description != meeting.get("description", ""):
            changes["description"] = {"from": meeting.get("description", ""), "to": description}
            meeting["description"] = description
        if not changes:
            return meeting
        meeting["updatedAt"] = datetime.now().isoformat()
        self.update_meta(request_id, meeting)
        self.log_activity(request_id, "edited", edited_by, changes)
        return meeting

    def log_activity(
        self, request_id: str, action: str, user_id: str, changes: Optional[dict] = None
    ) -> None:
        ts = datetime.now().isoformat()
        item: dict = {"action": action, "by": user_id, "at": ts}
        if changes:
            item["changes"] = json.dumps(changes)
        self._db.put(f"MEET#{request_id}", f"LOG#{ts}", item)

    def get_activity_log(self, request_id: str) -> List[dict]:
        items = self._db.query_prefix(f"MEET#{request_id}", "LOG#")
        return sorted(items, key=lambda x: x.get("at", ""))

    def get_user_meetings(self, user_id: str) -> List[models.MeetingRequest]:
        part_items = self._db.query_prefix(f"USER#{user_id}", "PART#")
        meeting_ids = {item.get("meetingId") for item in part_items if item.get("meetingId")}

        meetings: List[models.MeetingRequest] = []
        fetched_ids: set = set()

        for mid in meeting_ids:
            item = self._db.get(f"MEET#{mid}", "META")
            if item:
                try:
                    meetings.append(models.MeetingRequest(**item))
                    fetched_ids.add(mid)
                except Exception as exc:
                    print(f"[repository] Failed to parse meeting {mid}: {exc}")

        # Legacy fallback scan for meetings without participation index records
        legacy = self._db.scan(
            FilterExpression=(
                Attr("PK").begins_with("MEET#")
                & Attr("SK").eq("META")
                & (Attr("creatorUserId").eq(user_id) | Attr("participantUserIds").contains(user_id))
            )
        )
        for item in legacy:
            mid = item.get("requestId", "")
            if mid and mid not in fetched_ids:
                try:
                    m = models.MeetingRequest(**item)
                    meetings.append(m)
                    self._write_participation_records(m)
                except Exception as exc:
                    print(f"[repository] Failed to parse legacy meeting {item.get('PK')}: {exc}")

        meetings.sort(key=lambda x: x.createdAt, reverse=True)
        return meetings


# ---------------------------------------------------------------------------
# CalendarRepository
# ---------------------------------------------------------------------------

class CalendarRepository:
    def __init__(self) -> None:
        self._db = get_db()

    def get_oauth_tokens(self, user_id: str, provider: str) -> Optional[dict]:
        return self._db.get(f"USER#{user_id}", f"OAUTH#{provider}")

    def save_oauth_tokens(self, user_id: str, provider: str, tokens: dict) -> None:
        item = {
            "provider": provider,
            "accessToken": tokens.get("access_token", ""),
            "refreshToken": tokens.get("refresh_token", ""),
            "expiresAt": tokens.get("expires_at", ""),
            "scopes": tokens.get("scope", ""),
            "calendarEmail": tokens.get("calendar_email", ""),
            "connectedAt": datetime.now().isoformat(),
        }
        self._db.put(f"USER#{user_id}", f"OAUTH#{provider}", item)

    def delete_oauth_tokens(self, user_id: str, provider: str) -> None:
        self._db.delete(f"USER#{user_id}", f"OAUTH#{provider}")

    def get_connected_calendars(self, user_id: str) -> dict:
        result = {}
        for provider in ("google", "microsoft"):
            tokens = self.get_oauth_tokens(user_id, provider)
            result[provider] = (
                {"connected": True, "email": tokens.get("calendarEmail", ""),
                 "connectedAt": tokens.get("connectedAt", "")}
                if tokens
                else {"connected": False, "email": ""}
            )
        return result

    def get_ics_url(self, user_id: str) -> str:
        profile = self._db.get(f"USER#{user_id}", "PROFILE")
        return (profile or {}).get("icsUrl", "")

    def save_ics_url(self, user_id: str, ics_url: str) -> None:
        data = self._db.get(f"USER#{user_id}", "PROFILE")
        if not data:
            return
        data["icsUrl"] = ics_url
        self._db.put(f"USER#{user_id}", "PROFILE", data)

    def save_oauth_state(self, user_id: str, provider: str, state: str) -> None:
        self._db.put(f"USER#{user_id}", f"OAUTH_STATE#{state}", {
            "provider": provider,
            "state": state,
            "ttlExpiry": int(time.time()) + 1800,
        })

    def validate_and_consume_oauth_state(self, user_id: str, state: str) -> Optional[str]:
        item = self._db.get(f"USER#{user_id}", f"OAUTH_STATE#{state}")
        if not item:
            return None
        if item.get("ttlExpiry", 0) < int(time.time()):
            return None
        self._db.delete(f"USER#{user_id}", f"OAUTH_STATE#{state}")
        return item.get("provider")

    # --- Watch channel (Google Calendar push notifications) ---

    def save_watch_channel(self, user_id: str, channel_id: str, resource_id: str, expires_at: str) -> None:
        """Store the active watch channel and create a reverse-lookup record."""
        self._db.put(f"USER#{user_id}", "GCAL_WATCH", {
            "channelId":   channel_id,
            "resourceId":  resource_id,
            "expiresAt":   expires_at,
            "changeToken": "0",
        })
        # Reverse lookup so the webhook handler can resolve channelId → userId
        self._db.put(f"GCAL_CHANNEL#{channel_id}", "LOOKUP", {
            "userId":     user_id,
            "channelId":  channel_id,
            "resourceId": resource_id,
        })

    def get_watch_channel(self, user_id: str) -> Optional[dict]:
        return self._db.get(f"USER#{user_id}", "GCAL_WATCH")

    def delete_watch_channel(self, user_id: str) -> None:
        channel = self.get_watch_channel(user_id)
        if channel:
            self._db.delete(f"GCAL_CHANNEL#{channel['channelId']}", "LOOKUP")
        self._db.delete(f"USER#{user_id}", "GCAL_WATCH")

    def get_user_id_by_channel(self, channel_id: str) -> Optional[str]:
        item = self._db.get(f"GCAL_CHANNEL#{channel_id}", "LOOKUP")
        return item.get("userId") if item else None

    def bump_change_token(self, user_id: str) -> None:
        """Increment changeToken so the frontend's sync poll detects a new webhook notification."""
        channel = self.get_watch_channel(user_id)
        if not channel:
            return
        channel["changeToken"] = str(int(time.time() * 1000))
        self._db.put(f"USER#{user_id}", "GCAL_WATCH", channel)

    def get_change_token(self, user_id: str) -> str:
        channel = self.get_watch_channel(user_id)
        return (channel or {}).get("changeToken", "0")
