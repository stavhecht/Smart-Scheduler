import logging
import os
from pathlib import Path
from typing import Optional

# Auto-load .env when running locally with uvicorn
if os.environ.get('ENVIRONMENT') == 'development':
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).parent.parent.parent / '.env')
    except ImportError:
        pass

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from src.common.auth import get_current_user_from_request, validate_access_token
from src.handlers.api.dispatcher import dispatch
from src.handlers.lambda_entry import sfn_router

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI()

_FRONTEND_URL = os.environ.get('FRONTEND_URL', 'https://main.dndn8x61u1xu5.amplifyapp.com')

app.add_middleware(
    CORSMiddleware,
    allow_origins=[_FRONTEND_URL, 'http://localhost:5273', 'http://localhost:5173'],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ---------------------------------------------------------------------------
# Lambda entry point
# ---------------------------------------------------------------------------

_mangum = Mangum(app)


def handler(event, context):
    print(f"[handler] event: {event}")
    if 'sfn_action' in event:
        return sfn_router(event, context)
    return _mangum(event, context)


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health(action: Optional[str] = None, token: Optional[str] = None, data: Optional[str] = None):
    """
    Public route (no JWT authorizer on API Gateway).
    Without query params → simple health check.
    With action + token → CORS-safe proxy used by the React frontend to bypass
    the JWT authorizer OPTIONS pre-flight issue on ANY /{proxy+}.
    """
    if not action or not token:
        return {"status": "ok", "db": "DynamoDB Active", "sfn": "SmartSchedulerWorkflow"}

    try:
        identity = validate_access_token(token)
        if not identity:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return dispatch(action, identity, data)
    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return {"status": "error", "action": action, "message": f"Internal error: {exc}"}


# ---------------------------------------------------------------------------
# REST API endpoints (secondary path — JWT authorizer on API Gateway)
# ---------------------------------------------------------------------------

from src.database.repository import MeetingRepository, UserRepository, CalendarRepository as _CalendarRepo

_wh_cal_repo = _CalendarRepo()
from src.handlers.api import meetings as _mtg_handlers
from src.handlers.api import profile as _prf_handlers

_user_repo = UserRepository()
_meeting_repo = MeetingRepository()


@app.post("/webhook/google-calendar")
async def google_calendar_webhook(request: Request):
    """
    Public endpoint — no JWT required. Receives push notifications from Google
    Calendar and bumps the user's changeToken so the frontend's sync poll detects
    the change within ~5 s and re-fetches events.
    """
    resource_state = request.headers.get("X-Goog-Resource-State", "")
    channel_id     = request.headers.get("X-Goog-Channel-ID", "")

    # Google sends an initial "sync" notification when the watch is first registered.
    # Just acknowledge it — there are no actual changes yet.
    if resource_state == "sync":
        return {"status": "ok"}

    if channel_id:
        user_id = _wh_cal_repo.get_user_id_by_channel(channel_id)
        if user_id:
            _wh_cal_repo.bump_change_token(user_id)

    return {"status": "ok"}


@app.get("/api/profile", response_model=dict)
def get_user_profile(request: Request):
    return _prf_handlers.handle_profile(get_current_user_from_request(request))


@app.get("/api/profile/stats", response_model=dict)
def get_profile_stats(request: Request):
    return _prf_handlers.handle_profile_stats(get_current_user_from_request(request))


@app.get("/api/meetings")
def get_meetings(request: Request, limit: int = 50, offset: int = 0):
    identity = get_current_user_from_request(request)
    user_id = identity["user_id"]
    all_meetings = _meeting_repo.get_user_meetings(user_id)
    total = len(all_meetings)
    page = all_meetings[offset: offset + limit]
    all_pids: set = set()
    for m in page:
        all_pids.update(m.participantUserIds)
    name_map = _user_repo.get_by_ids(list(all_pids))
    response_data = []
    for m in page:
        slots = _meeting_repo.get_slots(m.requestId)
        d = m.model_dump(mode="json")
        d["slots"] = [s.model_dump(mode="json") for s in slots]
        d["userRole"] = "organizer" if m.creatorUserId == user_id else "participant"
        d["participantNames"] = {pid: name_map.get(pid, {"name": pid, "email": ""}) for pid in m.participantUserIds}
        response_data.append(d)
    return {"meetings": response_data, "total": total, "offset": offset, "limit": limit}


@app.post("/api/meetings/create")
def create_meeting_rest(request: Request):
    identity = get_current_user_from_request(request)
    return _mtg_handlers.handle_create_meeting(identity, None)


@app.post("/api/meetings/{request_id}/book/{slot_start_iso}")
def book_meeting_slot(request_id: str, slot_start_iso: str, request: Request):
    identity = get_current_user_from_request(request)
    return _mtg_handlers.handle_book(identity, f"book:{request_id}:{slot_start_iso}", None)


@app.post("/api/meetings/{request_id}/accept")
def accept_meeting(request_id: str, request: Request):
    identity = get_current_user_from_request(request)
    return _mtg_handlers.handle_accept(identity, f"accept:{request_id}")
