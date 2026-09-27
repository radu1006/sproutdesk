'use strict';

/**
 * Front-end store contract (`public/js/state.js`).
 *
 * The store is plain ES modules and touches no DOM at import time, so Node can
 * exercise it directly. This is the regression guard for the bug that stopped
 * the sign-in screen from ever rendering: `emit()` called `listeners.slice()`
 * on a `Set`, so every `setUser()` / `setSettings()` / `setUnread()` /
 * `loadClassrooms()` threw a TypeError and the app stayed on "Starting up…".
 *
 * The cached lookups (`loadClassrooms`, `loadChildren`, `loadCurrencyOptions`)
 * are pinned here too: they are read by more than one view, so a change of shape
 * would break several screens at once.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const STATE_MODULE = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'state.js')).href;

let cached = null;
function store() {
  if (!cached) cached = import(STATE_MODULE);
  return cached;
}

/** Minimal `window` + `fetch` stand-ins for the two cached lookups. */
function stubBrowser(payloads = {}) {
  const calls = [];
  const original = { window: globalThis.window, fetch: globalThis.fetch };

  globalThis.window = {
    location: { origin: 'http://localhost:3000' },
    dispatchEvent() {},
  };
  globalThis.fetch = async (url) => {
    const key = String(url).replace('http://localhost:3000/api', '');
    calls.push(key);
    const data = payloads[key];
    const found = data !== undefined;
    return {
      ok: found,
      status: found ? 200 : 404,
      text: async () =>
        JSON.stringify(found ? { data } : { error: { message: 'not found', code: 'not_found' } }),
    };
  };

  return {
    calls,
    restore() {
      globalThis.window = original.window;
      globalThis.fetch = original.fetch;
    },
  };
}

test('clearing the session (the sign-in screen path) never throws', async () => {
  const state = await store();
  state.setUser({ email: 'admin@sproutdesk.test', role: 'admin' });

  assert.doesNotThrow(() => state.setUser(null));
  assert.equal(state.getUser(), null);
  assert.equal(state.isAdmin(), false);
  assert.equal(state.canManage(), false);
  assert.equal(state.hasRole('admin'), false);
});

test('emit notifies every subscriber with the current state', async () => {
  const state = await store();
  const seen = [];
  const off = state.subscribe((snapshot) => seen.push(snapshot.user));

  assert.doesNotThrow(() => state.setUser({ email: 'admin@sproutdesk.test', role: 'admin' }));

  assert.equal(seen.length, 1);
  assert.equal(seen[0].email, 'admin@sproutdesk.test');
  assert.equal(state.getUser().role, 'admin');
  assert.equal(state.isAdmin(), true);
  assert.equal(state.isParent(), false);
  assert.equal(state.canManage(), true);

  off();
  state.setUser(null);
});

test('unsubscribing stops notifications, including from inside a listener', async () => {
  const state = await store();
  const seen = [];
  const off = state.subscribe(() => {
    seen.push('notified');
    off();
  });

  state.setUser({ email: 'first@example.test', role: 'parent' });
  state.setUser({ email: 'second@example.test', role: 'parent' });

  assert.deepEqual(seen, ['notified']);
  state.setUser(null);
});

test('settings helpers read the snake_case values with sane fallbacks', async () => {
  const state = await store();

  state.setSettings({
    school_name: 'Little Sprouts',
    school_tagline: 'Grow with us',
    currency: 'EUR',
    default_due_day: '5',
  });

  assert.equal(state.currency(), 'EUR');
  assert.equal(state.schoolName(), 'Little Sprouts');
  assert.equal(state.schoolTagline(), 'Grow with us');
  assert.equal(state.defaultDueDay(), 5);
  assert.equal(state.setting('school_name'), 'Little Sprouts');
  assert.equal(state.setting('missing_key', 'fallback'), 'fallback');

  state.setSettings({ default_due_day: '31' });
  assert.equal(state.currency(), 'USD');
  assert.equal(state.schoolName(), 'SproutDesk');
  assert.equal(state.schoolTagline(), '');
  assert.equal(state.defaultDueDay(), 10);

  state.setSettings(null);
  assert.equal(state.schoolName(), 'SproutDesk');
});

test('the currency choices come from the settings schema and are cached', async () => {
  const state = await store();
  const browser = stubBrowser({
    '/settings': {
      settings: { currency: 'RON' },
      schema: [
        { key: 'timezone', label: 'Timezone' },
        {
          key: 'currency',
          label: 'Currency code',
          options: [
            { value: 'EUR', label: 'EUR — Euro (€)' },
            { value: 'RON', label: 'RON — Romanian leu (lei)' },
          ],
        },
      ],
    },
  });

  try {
    const options = await state.loadCurrencyOptions();
    assert.deepEqual(
      options.map((option) => option.value),
      ['EUR', 'RON'],
    );
    assert.equal(state.currencyOptions(), options);

    await state.loadCurrencyOptions();
    assert.equal(
      browser.calls.filter((call) => call === '/settings').length,
      1,
      'the list is fetched once and then cached',
    );
  } finally {
    browser.restore();
  }
});

test('unread counts merge over the defaults', async () => {
  const state = await store();

  state.setUnread({ messages: 3 });
  assert.deepEqual(state.unread(), { messages: 3, notifications: 0, total: 0 });

  state.setUnread({ messages: 1, notifications: 2, total: 3 });
  assert.deepEqual(state.unread(), { messages: 1, notifications: 2, total: 3 });
});

test('loadClassrooms/loadChildren notify, cache and invalidate correctly', async () => {
  const state = await store();
  const browser = stubBrowser({
    '/classrooms': [
      { id: 1, name: 'Sunflowers', ageGroup: '3-4' },
      { id: 2, name: 'Seedlings' },
    ],
    '/children': {
      children: [{ id: 7, firstName: 'Ada', lastName: 'Lovelace', classroomId: 1 }],
    },
  });
  const countOf = (key) => browser.calls.filter((call) => call === key).length;

  try {
    const notices = [];
    const off = state.subscribe(() => notices.push('emit'));

    const classrooms = await state.loadClassrooms();
    assert.equal(classrooms.length, 2);
    assert.equal(notices.length, 1);
    assert.equal(state.classroomName(1), 'Sunflowers');
    assert.equal(state.classroomName(999), '');
    assert.deepEqual(state.classroomOptions({ includeAll: true })[0], {
      value: '',
      label: 'All classrooms',
    });
    assert.equal(state.classroomOptions()[0].label, 'Sunflowers (3-4)');

    await state.loadClassrooms();
    assert.equal(countOf('/classrooms'), 1, 'the second read is served from cache');

    await state.loadClassrooms({ force: true });
    assert.equal(countOf('/classrooms'), 2);

    state.invalidate('classrooms');
    await state.loadClassrooms();
    assert.equal(countOf('/classrooms'), 3);

    const children = await state.loadChildren();
    assert.equal(children.length, 1);
    assert.equal(state.childLabel(children[0]), 'Ada Lovelace · Sunflowers');
    assert.deepEqual(state.childOptions(), [{ value: '7', label: 'Ada Lovelace' }]);
    assert.equal(state.childOptions({ classroomId: 2 }).length, 0);
    assert.equal(state.children().length, 1);

    off();
  } finally {
    browser.restore();
    state.invalidate('classrooms', 'children');
  }
});
