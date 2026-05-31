/**
 * apiClient.js
 *
 * CORS-safe API client for Smart Scheduler.
 *
 * WHY THIS EXISTS:
 * The API Gateway route ANY /{proxy+} has a Cognito JWT authorizer.
 * That authorizer returns 401 on OPTIONS pre-flight requests (which carry no
 * Bearer token), causing browsers to reject every cross-origin request.
 * The AWS Academy lab policy blocks all API Gateway modifications.
 *
 * SOLUTION:
 * All calls are tunnelled through GET /health – a public route (no JWT
 * authorizer).  Plain GET requests with no custom headers are "simple
 * requests" under the CORS spec and never trigger a pre-flight check.
 * The backend validates the Cognito *access* token via cognito-idp:GetUser
 * (no IAM required) and dispatches based on the `action` query param.
 */

import { fetchAuthSession } from 'aws-amplify/auth';
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/** Returns the Cognito access token. Pass forceRefresh=true to force a new token. */
async function getAccessToken(forceRefresh = false) {
    try {
        const session = await fetchAuthSession({ forceRefresh });
        return session.tokens?.accessToken?.toString() ?? '';
    } catch (e) {
        console.error('[apiClient] Could not retrieve access token:', e);
        return '';
    }
}

/**
 * Core proxy call.
 * Builds: GET /health?action=<action>[&data=<json>]&token=<accessToken>
 *
 * Sending the token in a query param (not Authorization header) means the
 * browser treats this as a simple CORS request – no pre-flight.
 *
 * On a 401, automatically retries once with a force-refreshed token in case
 * the access token had just expired.
 */
async function apiProxy(action, data = null, _isRetry = false) {
    const token = await getAccessToken(_isRetry);
    if (!token) throw new Error('Not authenticated');

    const params = new URLSearchParams({ action, token });
    if (data !== null) params.set('data', JSON.stringify(data));

    const url = `${API_BASE}/health?${params.toString()}`;

    const res = await fetch(url); // simple GET – no custom headers
    if (!res.ok) {
        // If 401 and we haven't retried yet, force-refresh the token and try once more
        if (res.status === 401 && !_isRetry) {
            console.warn('[apiClient] Got 401, refreshing token and retrying…');
            return apiProxy(action, data, true);
        }
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status} at action=${action}`);
    }
    // The health endpoint always returns HTTP 200 (to avoid CORS-blocked 5xx).
    // Check the body's status field to detect backend errors.
    const body = await res.json();
    if (body?.status === 'error') {
        throw new Error(body.message || `Server error at action=${action}`);
    }
    return body;
}

/* ── Public API ─────────────────────────────────────────────────────────── */

export async function apiGet(path) {
    if (path === '/api/profile') return apiProxy('profile');
    if (path === '/api/meetings') return apiProxy('meetings');
    if (path === '/api/calendar/status') return apiProxy('calendar_status');

    // /api/calendar/events?timeMin=...&timeMax=...
    const calEventsMatch = path.match(/^\/api\/calendar\/events\?(.+)$/);
    if (calEventsMatch) {
        const p = new URLSearchParams(calEventsMatch[1]);
        return apiProxy('calendar_events', { timeMin: p.get('timeMin'), timeMax: p.get('timeMax') });
    }

    // /api/meetings/<id>/log
    const logMatch = path.match(/^\/api\/meetings\/([^/]+)\/log$/);
    if (logMatch) return apiProxy(`meeting_log:${logMatch[1]}`);

    // /api/calendar/oauth_url?provider=<provider>
    const oauthUrlMatch = path.match(/^\/api\/calendar\/oauth_url\?provider=(.+)$/);
    if (oauthUrlMatch) return apiProxy(`oauth_url:${oauthUrlMatch[1]}`, { redirect_origin: window.location.origin });

    if (path === '/api/profile/stats') return apiProxy('profile_stats');

    if (path === '/api/activity') return apiProxy('activity_feed');

    if (path === '/api/users') return apiProxy('list_users');

    // /api/users/<userId>/shared_meetings
    const sharedMatch = path.match(/^\/api\/users\/([^/]+)\/shared_meetings$/);
    if (sharedMatch) return apiProxy(`shared_meetings:${sharedMatch[1]}`);

    // /api/profile/<userId>
    const publicProfileMatch = path.match(/^\/api\/profile\/([^/]+)$/);
    if (publicProfileMatch) return apiProxy(`get_public_profile:${publicProfileMatch[1]}`);

    return apiProxy(path);
}

export async function apiPost(path, body) {
    if (path === '/api/meetings/create') return apiProxy('create_meeting', body);

    // /api/meetings/<id>/accept
    const acceptMatch = path.match(/^\/api\/meetings\/([^/]+)\/accept$/);
    if (acceptMatch) return apiProxy(`accept:${acceptMatch[1]}`);

    // /api/meetings/<id>/book/<slot>  (slot may be URL-encoded)
    const bookMatch = path.match(/^\/api\/meetings\/([^/]+)\/book\/(.+)$/);
    if (bookMatch) return apiProxy(`book:${bookMatch[1]}:${decodeURIComponent(bookMatch[2])}`);

    // /api/meetings/<id>/decline
    const declineMatch = path.match(/^\/api\/meetings\/([^/]+)\/decline$/);
    if (declineMatch) return apiProxy(`decline:${declineMatch[1]}`, body);

    // /api/meetings/<id>/cancel
    const cancelMatch = path.match(/^\/api\/meetings\/([^/]+)\/cancel$/);
    if (cancelMatch) return apiProxy(`cancel:${cancelMatch[1]}`);

    // /api/meetings/<id>/edit
    const editMatch = path.match(/^\/api\/meetings\/([^/]+)\/edit$/);
    if (editMatch) return apiProxy(`edit:${editMatch[1]}`, body);

    // /api/meetings/<id>/reschedule
    const rescheduleMatch = path.match(/^\/api\/meetings\/([^/]+)\/reschedule$/);
    if (rescheduleMatch) return apiProxy(`reschedule:${rescheduleMatch[1]}`);

    // /api/calendar/callback — OAuth authorization code exchange
    if (path === '/api/calendar/callback') return apiProxy(`oauth_callback:${body.provider}`, body);

    // /api/calendar/disconnect
    if (path === '/api/calendar/disconnect') return apiProxy(`calendar_disconnect:${body.provider}`);

    // /api/meetings/<id>/book_custom
    const bookCustomMatch = path.match(/^\/api\/meetings\/([^/]+)\/book_custom$/);
    if (bookCustomMatch) return apiProxy(`book_custom:${bookCustomMatch[1]}`, body);

    // /api/profile/fairness/reset
    if (path === '/api/profile/fairness/reset') return apiProxy('reset_fairness');

    // /api/profile/update
    if (path === '/api/profile/update') return apiProxy('update_profile', body);

    return apiProxy(path, body);
}

/** Score a manually selected time slot for fairness (no side effects). */
export async function apiScoreSlot(startIso, durationMinutes, participantIds = []) {
    return apiProxy('score_slot', { startIso, durationMinutes, participantIds });
}

/** Parse a free-text meeting request into prefill fields. */
export async function apiParseMeetingNL(text) {
    return apiProxy('parse_meeting_nl', { text });
}

/** Save (or clear) the user's .ics calendar feed URL. */
export async function apiUpdateIcsUrl(icsUrl) {
    return apiProxy('update_ics_url', { icsUrl });
}

/** Register (or renew) a Google Calendar push-notification watch channel. */
export async function apiRegisterCalendarWatch() {
    return apiProxy('register_calendar_watch');
}

/**
 * Returns { changeToken } — an opaque string that increments each time Google
 * fires a webhook notification. The frontend compares this against its cached
 * value to decide whether to re-fetch calendar events.
 */
export async function apiCheckCalendarSync() {
    return apiProxy('check_calendar_sync');
}

/** Stop the active watch channel (called automatically on Google Calendar disconnect). */
export async function apiStopCalendarWatch() {
    return apiProxy('stop_calendar_watch');
}
