'use strict';

/**
 * Thin fetch wrapper around the SproutDesk JSON API.
 *
 * Every response is `{ data: ... }` on success and `{ error: { message, code } }`
 * on failure; this module unwraps the success case and turns the failure case
 * into a thrown Error with `status` and `code` attached.
 *
 * A 401 dispatches `sprout:unauthorized` so the app can return to the sign-in
 * screen from anywhere without every view handling it.
 */

const BASE = '/api';

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code || null;
  }
}

async function request(method, path, { body, query, formData } = {}) {
  const url = new URL(BASE + path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, value);
    }
  }

  const options = { method, credentials: 'same-origin', headers: {} };
  if (formData) {
    options.body = formData;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (cause) {
    throw new ApiError('The server could not be reached. Is it still running?', 0, 'offline');
  }

  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload?.error?.message || `Request failed with status ${response.status}.`;
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('sprout:unauthorized'));
    }
    throw new ApiError(message, response.status, payload?.error?.code);
  }

  return payload ? payload.data : null;
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  delete: (path) => request('DELETE', path),
  upload: (path, file, fieldName = 'file') => {
    const formData = new FormData();
    formData.append(fieldName, file);
    return request('POST', path, { formData });
  },
};

/* Frequently used lookups, kept in one place so views stay short. */

export const endpoints = {
  me: () => api.get('/auth/me'),
  login: (email, password) => api.post('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
  dashboard: () => api.get('/dashboard'),
  classrooms: (query) => api.get('/classrooms', query),
  children: (query) => api.get('/children', query),
  child: (id) => api.get(`/children/${id}`),
  users: (query) => api.get('/users', query),
  settings: () => api.get('/settings'),
  health: () => api.get('/health'),
};

export default api;
