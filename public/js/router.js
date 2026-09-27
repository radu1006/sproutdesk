'use strict';

/**
 * Hash router. Routes look like `#/attendance?date=2026-09-24&classroomId=2`,
 * which keeps deep links working on a plain static file server (no history
 * fallback needed beyond what `server.js` already provides).
 */

const ROUTE_SEPARATOR = '/';

export function parseHash(hash = window.location.hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const segments = pathPart.split(ROUTE_SEPARATOR).filter(Boolean);
  const query = {};
  for (const [key, value] of new URLSearchParams(queryPart)) query[key] = value;
  return { path: `${ROUTE_SEPARATOR}${segments.join(ROUTE_SEPARATOR)}`, segments, query };
}

export function currentPath() {
  return parseHash().path;
}

export function buildHash(path, query) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, value);
  }
  const suffix = search.toString();
  return `#${path}${suffix ? `?${suffix}` : ''}`;
}

export function navigate(path, query) {
  const next = buildHash(path, query);
  if (window.location.hash === next) {
    notify();
    return;
  }
  window.location.hash = next;
}

/** Replaces the current history entry (used for unknown/invalid routes). */
export function replace(path, query) {
  window.location.replace(`${window.location.pathname}${buildHash(path, query)}`);
}

/** Replaces the query string of the current route without adding history noise. */
export function replaceQuery(query) {
  const { path, query: current } = parseHash();
  const merged = { ...current, ...query };
  window.location.replace(`${window.location.pathname}${buildHash(path, merged)}`);
}

let handler = () => {};

export function onRouteChange(callback) {
  handler = callback;
}

function notify() {
  handler();
}

export function startRouter() {
  window.addEventListener('hashchange', notify);
  notify();
}

/** First matching route wins; `:name` segments are captured as params. */
export function matchRoute(routes, path) {
  const segments = path.split(ROUTE_SEPARATOR).filter(Boolean);
  for (const route of routes) {
    const routeSegments = route.path.split(ROUTE_SEPARATOR).filter(Boolean);
    if (routeSegments.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let index = 0; index < routeSegments.length; index += 1) {
      const expected = routeSegments[index];
      const actual = segments[index];
      if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
      else if (expected !== actual) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}
