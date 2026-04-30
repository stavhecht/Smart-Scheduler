"""
calendar_client.py — Google Calendar & Microsoft Outlook OAuth integration.

Uses only Python stdlib (urllib.request / urllib.parse / json) so the Lambda
ZIP stays small.  No google-auth, no msal, no requests/httpx.

OAuth Flow:
  1. Frontend calls action=oauth_url:google  → gets redirect URL
  2. User is redirected to Google/Microsoft consent screen
  3. Provider redirects back to FRONTEND_URL/?code=...&state=...
  4. Frontend calls action=oauth_callback:google with {code, state}
  5. Backend exchanges code → stores tokens in DynamoDB
  6. On subsequent API calls, tokens are used to read/write calendar events
"""

import json
import os
import time
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Dict

import db   # local module

# ---------------------------------------------------------------------------
# Config (from Lambda environment variables)
# ---------------------------------------------------------------------------

FRONTEND_URL         = os.environ.get('FRONTEND_URL', 'https://main.dswqybh1v4bo.amplifyapp.com')
GOOGLE_CLIENT_ID     = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
MS_CLIENT_ID         = os.environ.get('MICROSOFT_CLIENT_ID', '')
MS_CLIENT_SECRET     = os.environ.get('MICROSOFT_CLIENT_SECRET', '')

# Redirect URI — Use the base URL directly (the React app handles query params on mount)
REDIRECT_URI = FRONTEND_URL if FRONTEND_URL.endswith('/') else FRONTEND_URL + '/'

GOOGLE_AUTH_URL   = 'https://accounts.google.com/o/oauth2/v2/auth'
GOOGLE_TOKEN_URL  = 'https://oauth2.googleapis.com/token'
GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
GOOGLE_USERINFO   = 'https://www.googleapis.com/oauth2/v3/userinfo'
GOOGLE_CALENDAR   = 'https://www.googleapis.com/calendar/v3'

MS_TENANT       = 'common'
MS_AUTH_URL     = f'https://login.microsoftonline.com/{MS_TENANT}/oauth2/v2.0/authorize'
MS_TOKEN_URL    = f'https://login.microsoftonline.com/{MS_TENANT}/oauth2/v2.0/token'
MS_GRAPH        = 'https://graph.microsoft.com/v1.0'


# ---------------------------------------------------------------------------
# Generic HTTP helpers
# ---------------------------------------------------------------------------

def _to_event_time(iso: str) -> dict:
    """
    Build the {dateTime, timeZone} dict for a calendar event body.
    - Strings with explicit UTC info (Z suffix or +offset) are normalised to
      'YYYY-MM-DDTHH:MM:SSZ' and paired with timeZone='UTC'.
    - Naive strings (no timezone suffix) are assumed to be Israel local time
      (from the frontend datetime-local input) and paired with
      timeZone='Asia/Jerusalem'.
    """
    s = iso.strip()
    has_tz = s.endswith('Z') or (len(s) > 10 and ('+' in s[10:] or s[10:].count('-') >= 1 and 'T' in s))
    if has_tz:
        # Normalise to Z format
        if not s.endswith('Z'):
            try:
                dt = datetime.fromisoformat(s)
                dt_utc = dt.astimezone(timezone.utc)
                s = dt_utc.strftime('%Y-%m-%dT%H:%M:%SZ')
            except Exception:
                pass
        return {'dateTime': s, 'timeZone': 'UTC'}
    return {'dateTime': s, 'timeZone': 'Asia/Jerusalem'}


def _http_get(url: str, headers: dict = None) -> dict:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def _http_post(url: str, data: dict, headers: dict = None) -> dict:
    encoded = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=encoded, headers=headers or {})
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


# ---------------------------------------------------------------------------
# Google Calendar OAuth
# ---------------------------------------------------------------------------

def get_google_auth_url(user_id: str) -> str:
    """Build the Google OAuth2 authorization URL and store state nonce."""
    import secrets
    state = secrets.token_urlsafe(24)
    db.save_oauth_state(user_id, 'google', state)

    params = urllib.parse.urlencode({
        'client_id':     GOOGLE_CLIENT_ID,
        'redirect_uri':  REDIRECT_URI,
        'response_type': 'code',
        'scope':         'openid email https://www.googleapis.com/auth/calendar',
        'access_type':   'offline',
        'prompt':        'consent',
        'state':         f'google:{user_id}:{state}',
    })
    return f"{GOOGLE_AUTH_URL}?{params}"


def exchange_google_code(code: str) -> dict:
    """Exchange authorization code for access + refresh tokens."""
    return _http_post(GOOGLE_TOKEN_URL, {
        'code':          code,
        'client_id':     GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SECRET,
        'redirect_uri':  REDIRECT_URI,
        'grant_type':    'authorization_code',
    })


def refresh_google_token(refresh_token: str) -> dict:
    """Refresh an expired Google access token."""
    return _http_post(GOOGLE_TOKEN_URL, {
        'refresh_token': refresh_token,
        'client_id':     GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SECRET,
        'grant_type':    'refresh_token',
    })


def get_google_user_email(access_token: str) -> str:
    """Fetch the Google account email via userinfo endpoint."""
    try:
        info = _http_get(GOOGLE_USERINFO, headers={'Authorization': f'Bearer {access_token}'})
        return info.get('email', '')
    except Exception:
        return ''


def get_microsoft_user_email(access_token: str) -> str:
    """Fetch the Microsoft account email via Graph /me endpoint (same pattern as Google)."""
    try:
        info = _http_get(f"{MS_GRAPH}/me", headers={'Authorization': f'Bearer {access_token}'})
        # 'mail' is the SMTP address; 'userPrincipalName' is the UPN fallback
        return info.get('mail') or info.get('userPrincipalName', '')
    except Exception:
        return ''


def _ensure_fresh_google_token(user_id: str) -> Optional[str]:
    """Return a valid access token, refreshing if needed. None if not connected."""
    tokens = db.get_oauth_tokens(user_id, 'google')
    if not tokens:
        return None

    expires_at = tokens.get('expiresAt', '')
    access_token = tokens.get('accessToken', '')
    refresh_token = tokens.get('refreshToken', '')

    # Refresh if expires within 5 minutes
    try:
        expires_ts = datetime.fromisoformat(expires_at).timestamp()
        if time.time() + 300 > expires_ts:
            refreshed = refresh_google_token(refresh_token)
            access_token = refreshed['access_token']
            new_expires = datetime.fromtimestamp(time.time() + refreshed.get('expires_in', 3600)).isoformat()
            db.save_oauth_tokens(user_id, 'google', {
                'access_token':  access_token,
                'refresh_token': refresh_token,   # Google doesn't always return a new one
                'expires_at':    new_expires,
                'scope':         tokens.get('scope', ''),
                'calendar_email': tokens.get('calendarEmail', ''),
            })
    except Exception as e:
        print(f"[calendar] Google token refresh failed for {user_id}: {e}")
        return None

    return access_token


def get_google_events(user_id: str, time_min: str, time_max: str) -> List[dict]:
    """Fetch Google Calendar events for the user in the given ISO time range."""
    token = _ensure_fresh_google_token(user_id)
    if not token:
        return []
    try:
        params = urllib.parse.urlencode({
            'timeMin':      time_min,
            'timeMax':      time_max,
            'singleEvents': 'true',
            'orderBy':      'startTime',
        })
        url = f"{GOOGLE_CALENDAR}/calendars/primary/events?{params}"
        resp = _http_get(url, headers={'Authorization': f'Bearer {token}'})
        events = []
        for ev in resp.get('items', []):
            start = ev.get('start', {}).get('dateTime') or ev.get('start', {}).get('date', '')
            end   = ev.get('end',   {}).get('dateTime') or ev.get('end',   {}).get('date', '')
            events.append({
                'summary': ev.get('summary', 'Busy'),
                'start':   start,
                'end':     end,
            })
        return events
    except Exception:
        return []


def create_google_event(user_id: str, title: str, start_iso: str, end_iso: str,
                        attendee_emails: List[str] = None) -> Optional[str]:
    """Create a Google Calendar event after booking. Returns the event ID on success, None on failure."""
    token = _ensure_fresh_google_token(user_id)
    if not token:
        return None
    try:
        event_body = {
            'summary': title,
            'start':   _to_event_time(start_iso),
            'end':     _to_event_time(end_iso),
            'attendees': [{'email': e} for e in (attendee_emails or [])],
        }
        data = json.dumps(event_body).encode()
        url  = f"{GOOGLE_CALENDAR}/calendars/primary/events"
        req  = urllib.request.Request(url, data=data, method='POST')
        req.add_header('Authorization', f'Bearer {token}')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp_body = json.loads(resp.read().decode())
            return resp_body.get('id')
    except Exception as e:
        print(f"[calendar] create_google_event failed for {user_id}: {e}")
        return None


def delete_google_event(user_id: str, event_id: str) -> bool:
    """Delete a Google Calendar event. Returns True on success."""
    token = _ensure_fresh_google_token(user_id)
    if not token or not event_id:
        return False
    try:
        url = f"{GOOGLE_CALENDAR}/calendars/primary/events/{event_id}"
        req = urllib.request.Request(url, method='DELETE')
        req.add_header('Authorization', f'Bearer {token}')
        with urllib.request.urlopen(req, timeout=10):
            return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Microsoft Outlook OAuth
# ---------------------------------------------------------------------------

def get_microsoft_auth_url(user_id: str) -> str:
    """Build the Microsoft OAuth2 authorization URL."""
    import secrets
    state = secrets.token_urlsafe(24)
    db.save_oauth_state(user_id, 'microsoft', state)

    params = urllib.parse.urlencode({
        'client_id':     MS_CLIENT_ID,
        'redirect_uri':  REDIRECT_URI,
        'response_type': 'code',
        'response_mode': 'query',
        'scope':         'openid email offline_access Calendars.ReadWrite',
        'state':         f'microsoft:{user_id}:{state}',
    })
    return f"{MS_AUTH_URL}?{params}"


def exchange_microsoft_code(code: str) -> dict:
    """Exchange authorization code for Microsoft tokens."""
    return _http_post(MS_TOKEN_URL, {
        'code':          code,
        'client_id':     MS_CLIENT_ID,
        'client_secret': MS_CLIENT_SECRET,
        'redirect_uri':  REDIRECT_URI,
        'grant_type':    'authorization_code',
    })


def refresh_microsoft_token(refresh_token: str) -> dict:
    """Refresh an expired Microsoft access token."""
    return _http_post(MS_TOKEN_URL, {
        'refresh_token': refresh_token,
        'client_id':     MS_CLIENT_ID,
        'client_secret': MS_CLIENT_SECRET,
        'grant_type':    'refresh_token',
        'scope':         'openid email offline_access Calendars.ReadWrite',
    })


def _ensure_fresh_microsoft_token(user_id: str) -> Optional[str]:
    """Return a valid Microsoft access token, refreshing if needed."""
    tokens = db.get_oauth_tokens(user_id, 'microsoft')
    if not tokens:
        return None

    expires_at   = tokens.get('expiresAt', '')
    access_token = tokens.get('accessToken', '')
    refresh_token = tokens.get('refreshToken', '')

    try:
        expires_ts = datetime.fromisoformat(expires_at).timestamp()
        if time.time() + 300 > expires_ts:
            refreshed    = refresh_microsoft_token(refresh_token)
            access_token = refreshed['access_token']
            new_expires  = datetime.fromtimestamp(
                time.time() + refreshed.get('expires_in', 3600)
            ).isoformat()
            db.save_oauth_tokens(user_id, 'microsoft', {
                'access_token':   access_token,
                'refresh_token':  refreshed.get('refresh_token', refresh_token),
                'expires_at':     new_expires,
                'scope':          tokens.get('scope', ''),
                'calendar_email': tokens.get('calendarEmail', ''),
            })
    except Exception as e:
        print(f"[calendar] Microsoft token refresh failed for {user_id}: {e}")
        return None

    return access_token


def get_microsoft_events(user_id: str, time_min: str, time_max: str) -> List[dict]:
    """Fetch Microsoft Graph calendar events for the user."""
    token = _ensure_fresh_microsoft_token(user_id)
    if not token:
        return []
    try:
        params = urllib.parse.urlencode({'startDateTime': time_min, 'endDateTime': time_max})
        url    = f"{MS_GRAPH}/me/calendarView?{params}"
        resp   = _http_get(url, headers={
            'Authorization': f'Bearer {token}',
            'Prefer':        'outlook.timezone="Asia/Jerusalem"',
        })
        events = []
        for ev in resp.get('value', []):
            events.append({
                'summary': ev.get('subject', 'Busy'),
                'start':   ev.get('start', {}).get('dateTime', ''),
                'end':     ev.get('end',   {}).get('dateTime', ''),
            })
        return events
    except Exception:
        return []


def create_microsoft_event(user_id: str, title: str, start_iso: str, end_iso: str,
                           attendee_emails: List[str] = None) -> Optional[str]:
    """Create an Outlook Calendar event after booking. Returns the event ID."""
    token = _ensure_fresh_microsoft_token(user_id)
    if not token:
        return None
    try:
        event_body = {
            'subject': title,
            'start':   _to_event_time(start_iso),
            'end':     _to_event_time(end_iso),
            'attendees': [
                {'emailAddress': {'address': e}, 'type': 'required'}
                for e in (attendee_emails or [])
            ],
        }
        data = json.dumps(event_body).encode()
        url  = f"{MS_GRAPH}/me/events"
        req  = urllib.request.Request(url, data=data, method='POST')
        req.add_header('Authorization', f'Bearer {token}')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp_body = json.loads(resp.read().decode())
            return resp_body.get('id')
    except Exception:
        return None


def delete_microsoft_event(user_id: str, event_id: str) -> bool:
    """Delete an Outlook Calendar event."""
    token = _ensure_fresh_microsoft_token(user_id)
    if not token or not event_id:
        return False
    try:
        url = f"{MS_GRAPH}/me/events/{event_id}"
        req = urllib.request.Request(url, method='DELETE')
        req.add_header('Authorization', f'Bearer {token}')
        with urllib.request.urlopen(req, timeout=10):
            return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# .ics calendar feed support (no Azure/OAuth registration needed)
# ---------------------------------------------------------------------------

def _ics_prop(vevent: str, prop: str) -> str:
    """Extract a simple property value from a VEVENT block string."""
    for line in vevent.splitlines():
        if line.startswith(prop + ':') or line.startswith(prop + ';'):
            colon_idx = line.index(':')
            return line[colon_idx + 1:].strip()
    return ''


def _ics_parse_dt(vevent: str, prop: str) -> Optional[datetime]:
    """Parse a DTSTART or DTEND value from a VEVENT block into a naive UTC datetime."""
    raw = ''
    for line in vevent.splitlines():
        if line.startswith(prop + ':') or line.startswith(prop + ';'):
            colon_idx = line.index(':')
            raw = line[colon_idx + 1:].strip()
            break
    if not raw:
        return None
    try:
        raw = raw.rstrip('Z')
        # DATE-only: YYYYMMDD
        if len(raw) == 8:
            return datetime(int(raw[:4]), int(raw[4:6]), int(raw[6:8]))
        # DATETIME: YYYYMMDDTHHMMSS
        clean = raw.replace('-', '').replace(':', '')
        if 'T' in clean:
            d, t = clean.split('T', 1)
            return datetime(int(d[:4]), int(d[4:6]), int(d[6:8]),
                            int(t[:2]), int(t[2:4]), int(t[4:6]) if len(t) >= 6 else 0)
        return datetime.fromisoformat(raw)
    except Exception:
        return None


def get_ics_events(ics_url: str, time_min_iso: str, time_max_iso: str) -> List[dict]:
    """
    Fetch and parse a public .ics calendar feed URL (e.g. Outlook shared calendar link).
    Returns events in the same format as get_google_events.
    Pure stdlib — no external libraries required.
    """
    try:
        req = urllib.request.Request(ics_url, headers={'User-Agent': 'SmartScheduler/1.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
    except Exception:
        return []

    events = []
    try:
        t_min = datetime.fromisoformat(time_min_iso.rstrip('Z'))
        t_max = datetime.fromisoformat(time_max_iso.rstrip('Z'))
    except Exception:
        t_min = t_max = None

    try:
        for block in raw.split('BEGIN:VEVENT')[1:]:
            end_idx = block.find('END:VEVENT')
            if end_idx == -1:
                continue
            vevent = block[:end_idx]

            if _ics_prop(vevent, 'STATUS').upper() == 'CANCELLED':
                continue

            dtstart = _ics_parse_dt(vevent, 'DTSTART')
            dtend   = _ics_parse_dt(vevent, 'DTEND')
            if not dtstart:
                continue

            ev_end = dtend or (dtstart + timedelta(hours=1))

            # Filter to requested time range
            if t_min and t_max:
                if dtstart >= t_max or ev_end <= t_min:
                    continue

            events.append({
                'summary': _ics_prop(vevent, 'SUMMARY') or 'Busy',
                'start':   dtstart.isoformat() + 'Z',
                'end':     ev_end.isoformat() + 'Z',
            })
    except Exception:
        pass

    return events


def generate_ics_content(title: str, start_iso: str, end_iso: str,
                          attendee_emails: List[str] = None) -> str:
    """Generate a valid .ics file string suitable for a meeting invite download."""
    import uuid as _uuid

    def _to_ics_dt(iso: str) -> str:
        s = iso.strip().rstrip('Z').replace('-', '').replace(':', '')
        s = s[:15] if 'T' in s else s + 'T000000'
        return s + 'Z'

    uid     = str(_uuid.uuid4())
    now     = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    dtstart = _to_ics_dt(start_iso)
    dtend   = _to_ics_dt(end_iso)

    lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//SmartScheduler//EN',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        f'UID:{uid}',
        f'DTSTAMP:{now}',
        f'DTSTART:{dtstart}',
        f'DTEND:{dtend}',
        f'SUMMARY:{title}',
    ]
    for email in (attendee_emails or []):
        lines.append(f'ATTENDEE;RSVP=TRUE:mailto:{email}')
    lines += ['END:VEVENT', 'END:VCALENDAR', '']

    return '\r\n'.join(lines)


# ---------------------------------------------------------------------------
# Unified helpers (used by fairness engine + booking flow)
# ---------------------------------------------------------------------------

def get_user_busy_slots(user_id: str, date_start: datetime, date_end: datetime) -> List[dict]:
    """
    Returns a unified list of busy time windows from the user's connected calendars.
    Tries Google first, then Microsoft, then .ics feed URL.
    Returns [] if no calendar connected.
    Each entry: {"start": ISO string, "end": ISO string, "summary": string}
    """
    time_min = date_start.isoformat() + 'Z'
    time_max = date_end.isoformat() + 'Z'

    events = get_google_events(user_id, time_min, time_max)
    if events:
        return events
    events = get_microsoft_events(user_id, time_min, time_max)
    if events:
        return events
    ics_url = db.get_user_ics_url(user_id)
    if ics_url:
        return get_ics_events(ics_url, time_min, time_max)
    return []


def write_meeting_to_calendars(creator_id: str, participant_ids: List[str],
                                title: str, start_iso: str, end_iso: str) -> dict:
    """
    Best-effort: write a confirmed meeting to every participant's connected calendar.
    Returns {"event_ids": {userId: externalEventId}, "failed": [userId, ...]}.
    """
    all_ids = list({creator_id} | set(participant_ids))
    # Collect attendee emails for invites (optional, but helps if providers sync)
    attendee_emails = []
    for uid in all_ids:
        tokens_g = db.get_oauth_tokens(uid, 'google')
        tokens_m = db.get_oauth_tokens(uid, 'microsoft')
        email = (tokens_g or tokens_m or {}).get('calendarEmail', '')
        if email:
            attendee_emails.append(email)

    event_ids: Dict[str, str] = {}
    failed_ids: List[str] = []
    for uid in all_ids:
        try:
            if db.get_oauth_tokens(uid, 'google'):
                eid = create_google_event(uid, title, start_iso, end_iso, attendee_emails)
                if eid:
                    event_ids[uid] = f"google:{eid}"
                else:
                    failed_ids.append(uid)
            elif db.get_oauth_tokens(uid, 'microsoft'):
                eid = create_microsoft_event(uid, title, start_iso, end_iso, attendee_emails)
                if eid:
                    event_ids[uid] = f"microsoft:{eid}"
                else:
                    failed_ids.append(uid)
        except Exception as e:
            print(f"[calendar] write failed for uid={uid}: {e}")
            failed_ids.append(uid)
    return {"event_ids": event_ids, "failed": failed_ids}


def remove_meeting_from_calendars(external_ids: Dict[str, str]):
    """
    Remove a previously booked meeting from all connected calendars.
    external_ids is a dict: {userId: "provider:eventId"}
    """
    if not external_ids:
        return
    for uid, composite_id in external_ids.items():
        try:
            if ':' not in composite_id: continue
            provider, eid = composite_id.split(':', 1)
            if provider == 'google':
                delete_google_event(uid, eid)
            elif provider == 'microsoft':
                delete_microsoft_event(uid, eid)
        except Exception:
            pass


def update_google_event(user_id: str, event_id: str, title: str,
                        start_iso: str, end_iso: str) -> bool:
    """Update an existing Google Calendar event's title and/or time. Returns True on success."""
    token = _ensure_fresh_google_token(user_id)
    if not token or not event_id:
        return False
    try:
        patch_body = {
            'summary': title,
            'start': _to_event_time(start_iso),
            'end':   _to_event_time(end_iso),
        }
        data = json.dumps(patch_body).encode()
        url  = f"{GOOGLE_CALENDAR}/calendars/primary/events/{event_id}"
        req  = urllib.request.Request(url, data=data, method='PATCH')
        req.add_header('Authorization', f'Bearer {token}')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=10):
            return True
    except Exception:
        return False


def update_microsoft_event(user_id: str, event_id: str, title: str,
                           start_iso: str, end_iso: str) -> bool:
    """Update an existing Outlook Calendar event. Returns True on success."""
    token = _ensure_fresh_microsoft_token(user_id)
    if not token or not event_id:
        return False
    try:
        patch_body = {
            'subject': title,
            'start': _to_event_time(start_iso),
            'end':   _to_event_time(end_iso),
        }
        data = json.dumps(patch_body).encode()
        url  = f"{MS_GRAPH}/me/events/{event_id}"
        req  = urllib.request.Request(url, data=data, method='PATCH')
        req.add_header('Authorization', f'Bearer {token}')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=10):
            return True
    except Exception:
        return False


def update_meeting_in_calendars(external_ids: Dict[str, str],
                                 title: str, start_iso: str, end_iso: str):
    """
    Best-effort: update a confirmed meeting in all connected calendars.
    external_ids is a dict: {userId: "provider:eventId"}
    """
    if not external_ids:
        return
    for uid, composite_id in external_ids.items():
        try:
            if ':' not in composite_id: continue
            provider, eid = composite_id.split(':', 1)
            if provider == 'google':
                update_google_event(uid, eid, title, start_iso, end_iso)
            elif provider == 'microsoft':
                update_microsoft_event(uid, eid, title, start_iso, end_iso)
        except Exception:
            pass
