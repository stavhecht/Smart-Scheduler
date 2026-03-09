/**
 * apiClient.js
 * Central HTTP client that automatically attaches the Cognito JWT token
 * to every request as an Authorization: Bearer header.
 */

import { fetchAuthSession } from 'aws-amplify/auth';

const API_BASE = 'https://85iuh9a158.execute-api.us-east-1.amazonaws.com';

/**
 * Fetches the current user's Cognito idToken and returns it as an auth header.
 * Falls back to an empty object if the user is not authenticated.
 */
async function getAuthHeaders() {
    try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    } catch (e) {
        console.error('[apiClient] Could not retrieve auth token:', e);
        return {};
    }
}

/**
 * Performs an authenticated GET request.
 * @param {string} path - API path, e.g. '/api/profile'
 * @returns {Promise<any>} Parsed JSON response
 */
export async function apiGet(path) {
    const authHeaders = await getAuthHeaders();
    const res = await fetch(`${API_BASE}${path}`, {
        headers: authHeaders,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText} at ${path}`);
    return res.json();
}

/**
 * Performs an authenticated POST request.
 * @param {string} path - API path, e.g. '/api/meetings/create'
 * @param {object} [body] - Optional JSON body
 * @returns {Promise<any>} Parsed JSON response
 */
export async function apiPost(path, body) {
    const authHeaders = await getAuthHeaders();
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText} at ${path}`);
    return res.json();
}
