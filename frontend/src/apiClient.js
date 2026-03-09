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

/** Returns the Cognito access token (used by backend for GetUser validation). */
async function getAccessToken() {
    try {
        const session = await fetchAuthSession();
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
 */
async function apiProxy(action, data = null) {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const params = new URLSearchParams({ action, token });
    if (data !== null) params.set('data', JSON.stringify(data));

    const url = `${API_BASE}/health?${params.toString()}`;

    const res = await fetch(url); // simple GET – no custom headers
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status} at action=${action}`);
    }
    return res.json();
}

/* ── Public API ─────────────────────────────────────────────────────────── */

export async function apiGet(path) {
    if (path === '/api/profile')  return apiProxy('profile');
    if (path === '/api/meetings') return apiProxy('meetings');
    return apiProxy(path);
}

export async function apiPost(path, body) {
    if (path === '/api/meetings/create') return apiProxy('create_meeting', body);

    // /api/meetings/<id>/accept
    const acceptMatch = path.match(/^\/api\/meetings\/([^/]+)\/accept$/);
    if (acceptMatch) return apiProxy(`accept:${acceptMatch[1]}`);

    // /api/meetings/<id>/book/<slot>
    const bookMatch = path.match(/^\/api\/meetings\/([^/]+)\/book\/(.+)$/);
    if (bookMatch) return apiProxy(`book:${bookMatch[1]}:${bookMatch[2]}`);

    return apiProxy(path, body);
}
