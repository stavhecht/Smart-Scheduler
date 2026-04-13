# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Full stack (Docker):**
```bash
docker-compose up --build          # frontend :80, backend :8000
```

**Frontend only (from `frontend/`):**
```bash
npm install && npm run dev         # Vite dev server at :5173
npm run lint                       # ESLint
npm run build                      # production build → dist/
```

**Backend only (from `backend/api/`):**
```bash
pip install -r requirements.txt
ENVIRONMENT=development uvicorn main:app --reload --port 8000
```

**Lambda package:**
```bash
python build_lambda.py             # → terraform/api_deployment.zip
```

**Terraform deploy (from `terraform/`):**
```bash
terraform apply -var="lab_role_arn=arn:aws:iam::975049889875:role/LabRole"
# api_deployment.zip must already exist in terraform/ before plan/apply
```

## Architecture

### Request Flow (Critical: CORS Proxy Pattern)

All frontend API calls go through a single public GET endpoint — **`GET /health`** — not the REST routes. This is intentional: the Cognito JWT authorizer on `ANY /{proxy+}` rejects CORS pre-flight OPTIONS requests with 401. Because AWS Academy blocks API Gateway policy changes, all calls tunnel through `/health` as simple GET requests (no pre-flight).

- `apiClient.js` encodes the logical action + Cognito access token as query params: `GET /health?action=<action>&token=<jwt>[&data=<json>]`
- The backend's `/health` handler decodes `action`, validates the token via `cognito-idp:GetUser`, dispatches to the appropriate handler, and always returns HTTP 200 (even for backend errors — check `body.status === 'error'`).
- `apiGet` / `apiPost` in `apiClient.js` are thin wrappers that map URL patterns to action strings.

Key action strings (full list in `apiClient.js`):

| Action | Triggered by |
|---|---|
| `profile`, `meetings`, `calendar_status` | `apiGet` |
| `activity_feed`, `list_users`, `get_messages`, `profile_stats` | `apiGet` |
| `get_public_profile:<userId>`, `shared_meetings:<userId>` | `apiGet` |
| `meeting_log:<id>`, `oauth_url:<provider>` | `apiGet` |
| `create_meeting`, `accept:<id>`, `book:<id>:<slot>` | `apiPost` |
| `cancel:<id>`, `edit:<id>`, `reschedule:<id>` | `apiPost` |
| `book_custom:<id>`, `update_profile`, `send_message:<userId>` | `apiPost` |
| `oauth_callback:<provider>`, `calendar_disconnect:<provider>` | `apiPost` |
| `score_slot`, `update_ics_url` | direct `apiProxy` calls |

### Lambda Dual-Dispatch (`main.py:handler`)

The Lambda entry point handles two event types:
1. **Step Functions invocations** — detected by the `sfn_action` key in the event; dispatched to `db.py`'s SFN step handlers.
2. **API Gateway invocations** — everything else goes through Mangum → FastAPI.

### Step Functions Workflow

`SmartSchedulerWorkflow` (EXPRESS type) runs slot generation when a meeting is created:
`FetchParticipantData → GenerateCandidateSlots → CalculateFairnessScores → CheckOptimizationNeeded → [ReshuffleSlots] → StoreResults`

Each step maps to a `sfn_*` function in `db.py`. The workflow is triggered from `main.py` when creating a meeting.

### Fairness Engine (`fairness_engine.py`)

Single `FairnessEngine` class, global `engine` singleton. Key concepts:
- **User score** (0–100): starts at 100, penalised by meetings this week (−2 each) and cancellations (−5 each), boosted by suffering score (+3 each).
- **Slot score**: combines `HOUR_WEIGHTS × DAY_WEIGHTS × 100` (base), load penalty (−30 max), social momentum bonus (+15 max), fairness variance penalty (−20 max).
- **Reshuffling Engine**: activates when average slot score < 75 (`OPTIMIZATION_THRESHOLD`); filters slots < 60, re-selects best.
- **Timezone handling**: slots are stored as UTC; `tz_offset_hours` converts to organizer local time for scoring.

### DynamoDB Access Pattern (`db.py`)

Single-table design (`SmartScheduler_V1`). Key schema:
- User profiles: `PK=USER#<id>`, `SK=PROFILE`
- Meetings: `PK=USER#<id>`, `SK=MTG#<requestId>`
- All floats converted to `Decimal` before writes; all reads should `float()` Decimal values.

### Frontend Components

| Component | Role |
|---|---|
| `App.jsx` | Router + global state (`AppContent`) |
| `MeetingDashboard.jsx` | Main scheduling UI (create, list, book) |
| `CalendarView.jsx` | Calendar display |
| `ProfileView.jsx` | User profile & metrics (5-tab) |
| `PublicProfile.jsx` | Public-facing profile modal |
| `PeopleView.jsx` | Social people list |
| `MessagesView.jsx` | In-app messaging |
| `MeetingDetailModal.jsx` | Meeting detail overlay |
| `CommandPalette.jsx` | Keyboard-driven command palette |
| `InboxPanel.jsx` | Inline inbox/notifications panel |

### State Management (Frontend)

State is lifted to `App.jsx` (`AppContent`). Child components receive data and callbacks via props — no global store. Key state:
- `profile`, `meetings`, `calendarStatus` — loaded on mount via `Promise.all`, auto-polled every 30s.
- `calendarToast` — single toast slot (replaces previous on new show).
- `targetProfile` — public profile modal (global, not per-route).
- OAuth callback params captured in `useState` initializer on mount (before React Router cleans the URL).

### Calendar Integration (`calendar_client.py`)

Supports Google Calendar (OAuth2) and Microsoft Outlook (.ics feed URL, no Azure app registration needed). OAuth credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`) must be set as Lambda environment variables — currently not configured in production.

## Key Env Vars

| Variable | Where set | Purpose |
|---|---|---|
| `TABLE_NAME` | Lambda | DynamoDB table name |
| `AWS_ACCOUNT_ID` | Lambda | Used to construct SFN ARN |
| `FRONTEND_URL` | Lambda | CORS allow-origin |
| `ENVIRONMENT` | local only | Set to `development` for local uvicorn |

## Terraform Notes

- No `terraform.tfvars` — always pass `lab_role_arn` via `-var=`.
- `lifecycle { ignore_changes = [target] }` on API Gateway (import drift).
- `lifecycle { ignore_changes = [explicit_auth_flows] }` on Cognito client.
- Lambda ARN for Step Functions is constructed at runtime from env vars to avoid circular Terraform dependency.
