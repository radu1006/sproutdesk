'use strict';

/**
 * Tiny application store: the signed-in user, a few cached lookups
 * (classrooms / children) and subscription-based change notifications.
 * No framework, no magic — views call `loadClassrooms()` and read the arrays.
 */

import { api } from './api.js';

const state = {
  user: null,
  settings: null,
  classrooms: [],
  children: [],
  currencyChoices: [],
  unread: { messages: 0, notifications: 0, total: 0 },
  loaded: { classrooms: false, children: false, currencyChoices: false },
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit() {
  // Snapshot first: a listener may unsubscribe while it is being notified.
  for (const listener of [...listeners]) listener(state);
}

export function getState() {
  return state;
}

/* ------------------------------------------------------------------- session */

export function setUser(user) {
  state.user = user;
  emit();
}

export function getUser() {
  return state.user;
}

export function hasRole(...roles) {
  return Boolean(state.user) && roles.includes(state.user.role);
}

export const isAdmin = () => hasRole('admin');
export const isTeacher = () => hasRole('teacher');
export const isParent = () => hasRole('parent');
export const canManage = () => hasRole('admin', 'teacher');

export function setSettings(settings) {
  state.settings = settings;
  emit();
}

export function settings() {
  return state.settings;
}

export function currency() {
  return state.settings?.currency || 'USD';
}

/** The centre settings arrive as raw `key -> value` pairs (snake_case keys). */
export function setting(key, fallback = '') {
  const value = state.settings?.[key];
  return value === undefined || value === null || value === '' ? fallback : value;
}

export function schoolName() {
  return setting('school_name', 'SproutDesk');
}

export function schoolTagline() {
  return setting('school_tagline', '');
}

export function defaultDueDay() {
  const day = Number(setting('default_due_day', '10'));
  return Number.isInteger(day) && day >= 1 && day <= 28 ? day : 10;
}

/* ------------------------------------------------------------------- lookups */

export function invalidate(...keys) {
  for (const key of keys) state.loaded[key] = false;
}

export async function loadClassrooms({ force = false } = {}) {
  if (state.loaded.classrooms && !force) return state.classrooms;
  const rows = await api.get('/classrooms');
  state.classrooms = Array.isArray(rows) ? rows : rows?.classrooms || [];
  state.loaded.classrooms = true;
  emit();
  return state.classrooms;
}

export async function loadChildren({ force = false } = {}) {
  if (state.loaded.children && !force) return state.children;
  const rows = await api.get('/children');
  state.children = Array.isArray(rows) ? rows : rows?.children || [];
  state.loaded.children = true;
  emit();
  return state.children;
}

export function classrooms() {
  return state.classrooms;
}

export function children() {
  return state.children;
}

/**
 * The currency codes an administrator can bill in (`GET /settings`). Cached
 * once: the list ships with the server code, so there is nothing to invalidate.
 */
export async function loadCurrencyOptions({ force = false } = {}) {
  if (state.loaded.currencyChoices && !force) return state.currencyChoices;
  const data = await api.get('/settings');
  const field = (data?.schema || []).find((row) => row.key === 'currency');
  state.currencyChoices = field?.options || [];
  state.loaded.currencyChoices = true;
  // No `emit()`: this only fills a picker, so nothing on screen has to redraw.
  return state.currencyChoices;
}

/** The codes loaded by `loadCurrencyOptions()`, or `[]` before that ran. */
export function currencyOptions() {
  return state.currencyChoices;
}

export function classroomName(id) {
  const found = state.classrooms.find((row) => Number(row.id) === Number(id));
  return found ? found.name : '';
}

export function childLabel(child) {
  if (!child) return '';
  const classroom = child.classroomName || classroomName(child.classroomId ?? child.classroom_id);
  return classroom ? `${child.firstName} ${child.lastName} · ${classroom}` : `${child.firstName} ${child.lastName}`;
}

export function classroomOptions({ includeAll = false, allLabel = 'All classrooms' } = {}) {
  const options = state.classrooms.map((row) => ({
    value: String(row.id),
    label: row.ageGroup ? `${row.name} (${row.ageGroup})` : row.name,
  }));
  if (includeAll) options.unshift({ value: '', label: allLabel });
  return options;
}

export function childOptions({ classroomId } = {}) {
  return state.children
    .filter((child) => !classroomId || String(child.classroomId ?? child.classroom_id) === String(classroomId))
    .map((child) => ({ value: String(child.id), label: `${child.firstName} ${child.lastName}` }));
}

/* ------------------------------------------------------------------- unread */

export function setUnread(unread) {
  state.unread = { messages: 0, notifications: 0, total: 0, ...unread };
  emit();
}

export function unread() {
  return state.unread;
}
