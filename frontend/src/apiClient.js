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

const API_BASE = 'https://du2fhsjyhl.execute-api.us-east-1.amazonaws.com';

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
    if (path === '/api/profile')         return apiProxy('profile');
    if (path === '/api/meetings')        return apiProxy('meetings');
    if (path === '/api/calendar/status') return apiProxy('calendar_status');

    // /api/meetings/<id>/log
    const logMatch = path.match(/^\/api\/meetings\/([^/]+)\/log$/);
    if (logMatch) return apiProxy(`meeting_log:${logMatch[1]}`);

    // /api/calendar/oauth_url?provider=<provider>
    const oauthUrlMatch = path.match(/^\/api\/calendar\/oauth_url\?provider=(.+)$/);
    if (oauthUrlMatch) return apiProxy(`oauth_url:${oauthUrlMatch[1]}`);

    if (path === '/api/profile/messages') return apiProxy('get_messages');

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

    // /api/profile/update
    if (path === '/api/profile/update') return apiProxy('update_profile', body);

    // /api/profile/<userId>/message
    const messageMatch = path.match(/^\/api\/profile\/([^/]+)\/message$/);
    if (messageMatch) return apiProxy(`send_message:${messageMatch[1]}`, body);

    return apiProxy(path, body);
}

/** Score a manually selected time slot for fairness (no side effects). */
export async function apiScoreSlot(startIso, durationMinutes, participantIds = []) {
    return apiProxy('score_slot', { startIso, durationMinutes, participantIds });
}
