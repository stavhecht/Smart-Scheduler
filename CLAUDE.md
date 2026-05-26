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
- The backend's `/health` handler in `main.py` validates the token via `cognito-idp:GetUser` (see `src/common/auth.py:validate_access_token`), then calls `src/handlers/api/dispatcher.py:dispatch`.
- The response is always HTTP 200 — even for backend errors. Frontend must check `body.status === 'error'`.
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
| `ai_fairness:<id>` | `apiGet` (poll for async AI fairness verdict) |
| `book_custom:<id>`, `update_profile`, `send_message:<userId>` | `apiPost` |
| `oauth_callback:<provider>`, `calendar_disconnect:<provider>` | `apiPost` |
| `score_slot`, `update_ics_url` | direct `apiProxy` calls |
- **Note:** The `decline` action (marked * in the table above) exists in the dispatcher but has no `apiClient.js` wrapper — it is not currently reachable from the frontend.

There are also secondary REST endpoints (`/api/profile`, `/api/meetings`, etc.) with the JWT authorizer from API Gateway — these are a secondary path not used by the main frontend.

### Backend Package Structure (`backend/api/src/`)

```
src/
├── common/
│   ├── auth.py              # Token validation (validate_access_token, get_current_user_from_request)
│   ├── calendar_client.py   # Google Calendar OAuth2 + Outlook .ics integration
│   ├── dynamo.py            # DynamoDB client singleton (get_db())
│   ├── openai_client.py     # AI slot scoring + NL meeting parsing (gpt-4.1-nano, stdlib urllib only)
│   └── timezone.py          # get_tz_offset_hours()
├── core/
│   └── fairness.py          # FairnessEngine class + global `engine` singleton
├── database/
│   ├── models.py            # Pydantic models (UserProfile, MeetingRequest, SuggestedTimeSlot, FairnessState, MeetingLogEntry)
│   └── repository.py        # UserRepository, MeetingRepository, CalendarRepository
└── handlers/
    ├── api/
    │   ├── dispatcher.py    # Routes action strings → handler functions
    │   ├── meetings.py      # handle_create_meeting, handle_book, handle_accept, etc.
    │   ├── profile.py       # handle_profile, handle_update_profile, handle_list_users, etc.
    │   ├── calendar.py      # handle_calendar_status, handle_oauth_url, handle_oauth_callback, etc.
    │   ├── _scheduling.py   # Slot generation helpers used by meetings.py
    │   └── _local_sim.py    # Local development simulator (no real AWS calls)
    ├── lambda_entry.py      # sfn_router() — Step Functions event dispatch
    └── workflow/
        ├── fetch_participants.py
        ├── generate_slots.py
        ├── calculate_fairness.py
        ├── reshuffle_slots.py
        └── store_results.py
```

### Lambda Dual-Dispatch (`main.py:handler`)

1. **Step Functions invocations** — detected by `sfn_action` key → `sfn_router()` in `lambda_entry.py` → maps to the appropriate `workflow/` handler.
2. **API Gateway invocations** — everything else → Mangum → FastAPI → `/health` → `dispatcher.dispatch()`.

**Local development shortcut:** When `AWS_ACCOUNT_ID` is not set (local uvicorn), `handle_create_meeting` skips Step Functions entirely and calls `_local_sim.run_simulation()` synchronously. This mirrors the full SFN workflow but runs in-process.

### Action Dispatch (`dispatcher.py`)

Two lookup tables: `EXACT` (exact match) and `PREFIX` (prefix match). Adding a new action means adding an entry to one of these tables and implementing the handler in `meetings.py`, `profile.py`, or `calendar.py`.

Key actions:

| Action | Handler |
|---|---|
| `profile`, `update_profile`, `profile_stats`, `list_users`, `activity_feed` | `profile.py` |
| `meetings`, `create_meeting`, `score_slot`, `parse_meeting_nl` | `meetings.py` |
| `book:<id>:<slot>`, `accept:<id>`, `decline:<id>`*, `cancel:<id>`, `edit:<id>`, `reschedule:<id>`, `book_custom:<id>`, `meeting_log:<id>` | `meetings.py` |
| `calendar_status`, `calendar_events`, `oauth_url:<p>`, `oauth_callback:<p>`, `calendar_disconnect:<p>`, `update_ics_url`, `register_calendar_watch`, `stop_calendar_watch`, `check_calendar_sync` | `calendar.py` |
| `get_public_profile:<id>`, `shared_meetings:<id>` | `profile.py` |

### Step Functions Workflow

`SmartSchedulerWorkflow` (EXPRESS type) runs when a meeting is created:
`FetchParticipantData → GenerateCandidateSlots → CalculateFairnessScores → CheckOptimizationNeeded → [ReshuffleSlots] → StoreResults`

Each step maps to a `sfn_*` function in `db.py`. The workflow is triggered from `main.py` when creating a meeting.

### AI Fairness Workflow (async — `SmartSchedulerFairnessAI`)

A second STANDARD-type Step Function runs in the background after meeting creation. It calls **gpt-4o-mini** via `src/core/ai_fairness.py` to produce a calibrated fairness verdict on top of the heuristic `FairnessEngine` output.

- **Trigger**: `_scheduling.run_or_schedule` calls `start_execution` (async, fire-and-forget) on `SmartSchedulerFairnessAI` immediately after the sync slot-generation workflow returns. Failures are logged but never raised — the user-facing meeting flow is decoupled from AI scoring.
- **Steps**: `AIFetchContext` → `AIScoreMeeting` → `AIStoreScore`, with a shared `Catch → RecordError` that writes an error marker so the frontend poll stops spinning.
- **Hybrid blend (Method C)**: AI may shift a heuristic score by at most ±15 pts (`AI_MAX_DELTA`). This preserves Method A as the source of truth and prevents the LLM from inventing wild swings.
- **Storage**:
  - `MEET#<id> / AISCORE` — latest verdict (frontend polls via `ai_fairness:<id>`)
  - `MEET#<id> / AIHIST#<ts>` — audit trail (TTL 90 days)
  - `USER#<id> / AIFAIRHIST#<ts>` — per-user fairness trajectory (TTL 365 days), feeds back into the next AI call as historical context
- **Privacy**: calendar event titles/locations/attendee emails are stripped before being sent to OpenAI; only start/end/duration/attendee-count is sent (`ai_fairness._redact_events`).
- **Cost guard**: participants capped at 25, events per participant capped at 40, history entries capped at 20 — bounded context window per call.
- **Failure mode**: if `OPENAI_API_KEY` is unset or the API errors, the agent returns a `heuristic_fallback` verdict (heuristic average), so the poll endpoint always resolves.
- **Observability**: state machine logs to `/aws/states/SmartSchedulerFairnessAI` (CloudWatch, 14-day retention). Handler logs use the `[ai_*]` prefix.
### AI Scoring (`src/common/openai_client.py`)

Uses `gpt-4.1-nano` via stdlib `urllib` (no OpenAI SDK in the Lambda ZIP). A single batched API call per meeting scores all candidate slots and produces a strategic summary. Hard-fails with `OpenAIScoreError` on any error — the deterministic fairness engine always runs first and AI scoring is additive. Requires `OPENAI_API_KEY` in Lambda env.

Two public entry points:
- `score_slots_with_ai(slots, participant_context)` — called by `calculate_fairness.py` in the SFN workflow
- `parse_meeting_intent(text, today_iso, known_users)` — called by `handle_parse_meeting_nl` in `meetings.py` to extract structured fields from a natural-language meeting request (`apiParseMeetingNL` in the frontend)

### Fairness Engine (`src/core/fairness.py`)

Single `FairnessEngine` class, global `engine` singleton. Key concepts:
- **User score** (0–100): starts at 100, penalised by meetings this week (−2 each) and cancellations (−5 each), boosted by suffering score (+3 each).
- **Slot score**: combines `HOUR_WEIGHTS × DAY_WEIGHTS × 100` (base), load penalty (−30 max), social momentum bonus (+15 max), fairness variance penalty (−20 max).
- **Reshuffling Engine**: activates when average slot score < 75 (`OPTIMIZATION_THRESHOLD`); filters slots < 60, re-selects best.

### DynamoDB Access Pattern (`src/database/repository.py`)

Single-table design (`SmartScheduler_V1`). Three repository classes: `UserRepository`, `MeetingRepository`, `CalendarRepository`. Key schema:
- `PK=USER#<id>`, `SK=PROFILE` — user profile
- `PK=USER#<id>`, `SK=FAIRNESS` — fairness scores / load metrics
- `PK=USER#<id>`, `SK=PART#<requestId>` — participation index (used to look up a user's meetings)
- `PK=USER#<id>`, `SK=OAUTH#<provider>` — OAuth tokens (Google/Microsoft)
- `PK=USER#<id>`, `SK=GCAL_WATCH` — active Google Calendar push-notification channel
- `PK=MEET#<requestId>`, `SK=META` — meeting metadata (`MeetingRequest`)
- `PK=MEET#<requestId>`, `SK=SLOT#<startIso>` — candidate time slots (`SuggestedTimeSlot`)
- `PK=MEET#<requestId>`, `SK=LOG#<timestamp>` — audit log entries
- `PK=GCAL_CHANNEL#<channelId>`, `SK=LOOKUP` — reverse lookup: channelId → userId

`BaseDBModel` in `models.py` has a `model_validator` that recursively converts `Decimal` → `int`/`float` on every DynamoDB read. All writes must convert floats → `Decimal` before storing.

### Frontend State Management (`App.jsx`)

State is lifted to `AppContent` in `App.jsx`. No global store — all data flows via props. Key state:
- `profile`, `meetings`, `calendarStatus` — loaded on mount via `Promise.all`, meetings auto-polled every 60s.
- `targetProfile` — public profile modal (global, controlled from any route).
- `showGlobalCreate` / `meetingPrefill` — global create modal triggered from calendar, people view, or `⌘K` palette.
- `selectedMeeting` — drives `MeetingDetailModal`.
- OAuth callback params captured in `useState` initializer on mount (before React Router cleans the URL).

Key components in `frontend/src/components/`:
- `MeetingDashboard.jsx` — main scheduling UI (meeting list, status, actions)
- `MeetingDetailModal.jsx` — detail/action modal for a single meeting
- `CreateMeetingModal.jsx` — meeting creation flow with slot selection
- `CalendarView.jsx` — calendar display
- `PeopleView.jsx` — user directory / people search
- `ProfileView.jsx` — current user profile & fairness metrics
- `PublicProfile.jsx` — public-facing profile view
- `CommandPalette.jsx` — `⌘K` global command palette

`frontend/src/context/ToastContext.jsx` provides a global toast notification context.

### Calendar Integration (`src/common/calendar_client.py`)

Supports Google Calendar (OAuth2) and Microsoft Outlook (.ics feed URL). Google push notifications land at `POST /webhook/google-calendar` (public, no JWT) and bump a `changeToken` in DynamoDB, which the frontend polls to detect changes.

## Key Env Vars

| Variable | Where set | Purpose |
|---|---|---|
| `TABLE_NAME` | Lambda / `.env` | DynamoDB table name |
| `AWS_ACCOUNT_ID` | Lambda | Used to construct SFN ARN; **absent locally** → `_local_sim` path |
| `FRONTEND_URL` | Lambda | CORS allow-origin |
| `OPENAI_API_KEY` | Lambda | gpt-4o-mini for AI fairness workflow (optional — heuristic fallback if unset) |
| `AI_FAIRNESS_MODEL` | Lambda | Defaults to `gpt-4o-mini`; override to pin a different model |
| `ENVIRONMENT` | local only | Set to `development` for local uvicorn |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Lambda | Google Calendar OAuth |
| `OPENAI_API_KEY` | Lambda | AI slot scoring + NL meeting parsing; absent → AI scoring silently skipped |
| `ENVIRONMENT` | local only | Set to `development` for local uvicorn + .env loading |
| `VITE_API_URL` | frontend `.env.local` | Backend URL for the Vite dev server (default: `http://localhost:8000`) |

### Local `.env` file

When `ENVIRONMENT=development`, `main.py` auto-loads `Smart-Scheduler/.env` (three directories above `backend/api/main.py`). Minimum required keys for local development:

```
TABLE_NAME=SmartScheduler_V1
AWS_DEFAULT_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=...   # if using temporary credentials (e.g. AWS Academy)
```

To point the Vite dev server at a local backend, create `frontend/.env.local`:
```
VITE_API_URL=http://localhost:8000
```

## Tests

There is no test suite. No pytest files exist in `backend/` and no Jest/Vitest files in `frontend/src/`.

## Terraform Notes

- No `terraform.tfvars` — always pass `lab_role_arn` via `-var=`.
- `lifecycle { ignore_changes = [target] }` on API Gateway (import drift).
- `lifecycle { ignore_changes = [explicit_auth_flows] }` on Cognito client.
- Lambda ARN for Step Functions is constructed at runtime from env vars to avoid circular Terraform dependency.
- `api_deployment.zip` must exist in `terraform/` before `terraform plan/apply` — run `python build_lambda.py` first.
- `frontend/src/aws-exports.js` is **not** managed by Terraform — update it manually after any Cognito pool/client recreation.
