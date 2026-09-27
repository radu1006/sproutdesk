'use strict';

/**
 * Attendance register.
 *
 * Staff get a whole-class quick register (one click per child) that is saved
 * with a single `POST /api/attendance/bulk`; families get a read-only view of
 * their own children plus a 30-day overview.
 */

import { api } from '../api.js';
import * as store from '../state.js';
import * as ui from '../ui.js';

const STATUSES = [
  { value: 'present', short: 'P', label: 'Present' },
  { value: 'late', short: 'L', label: 'Late' },
  { value: 'absent', short: 'A', label: 'Absent' },
  { value: 'sick', short: 'S', label: 'Sick' },
  { value: 'holiday', short: 'H', label: 'Holiday' },
];

const TONES = { present: 'success', late: 'warn', absent: 'danger', sick: 'danger', holiday: 'info' };

/** "HH:MM:SS" from the database -> "HH:MM" for <input type="time">. */
const timeValue = (value) => (value ? String(value).slice(0, 5) : '');

export default async function renderAttendance(container, ctx) {
  const date = ctx.query.date || ui.today();
  const classroomId = ctx.query.classroomId || '';
  const isStaff = ctx.user.role !== 'parent';

  const [children, data] = await Promise.all([
    isStaff ? store.loadChildren({ force: true }) : Promise.resolve([]),
    api.get('/attendance', { date, classroomId }),
  ]);

  const summary = data.summary || {};
  const stats = ui.el(
    'div',
    { class: 'stats' },
    ui.stat(summary.recorded ?? data.records.length, 'records'),
    ...STATUSES.map((status) =>
      ui.stat(summary[status.value] ?? 0, status.label.toLowerCase(), { tone: TONES[status.value] === 'danger' ? 'bad' : TONES[status.value] === 'warn' ? 'warn' : 'neutral' }),
    ),
  );

  const dateInput = ui.input({ name: 'date', type: 'date', value: date });
  const classroomSelect = isStaff
    ? ui.select({
        name: 'classroomId',
        value: classroomId,
        options: store.classroomOptions({ includeAll: true }),
      })
    : null;

  const toolbar = ui.toolbar(
    ui.field('Date', dateInput),
    classroomSelect ? ui.field('Classroom', classroomSelect) : null,
    ui.button('Load', {
      kind: 'ghost',
      onClick: () => {
        const query = { date: dateInput.value || ui.today() };
        if (classroomSelect?.value) query.classroomId = classroomSelect.value;
        ctx.go('/attendance', query);
      },
    }),
  );

  const records = data.records || [];
  const body = isStaff
    ? registerCard({ children, records, date, classroomId, ctx })
    : parentCard({ records, date, ctx });

  ui.mount(
    container,
    ui.card({ title: 'Register', subtitle: `Attendance for ${ui.fmtDate(date)}`, body: toolbar }),
    ui.card({ title: 'Summary', body: stats }),
    body,
    isStaff ? historyCard({ ctx }) : null,
  );
}

/* ------------------------------------------------------------------ families */

function parentCard({ records, date, ctx }) {
  return ui.card({
    title: 'My children',
    subtitle: ui.fmtDate(date),
    actions: ui.button('Last 30 days', {
      kind: 'ghost',
      onClick: async () => {
        const days = await loadHistory(ctx.user);
        ui.openModal({
          title: 'Attendance over the last 30 days',
          body: historyTable(days),
        });
      },
    }),
    body: records.length
      ? ui.table({
          columns: [
            { header: 'Child', render: (row) => row.childName },
            {
              header: 'Status',
              render: (row) => ui.badge(ui.label(row.status), TONES[row.status] || 'neutral'),
            },
            { header: 'Checked in', render: (row) => timeValue(row.checkInTime) || '—' },
            { header: 'Checked out', render: (row) => timeValue(row.checkOutTime) || '—' },
            { header: 'Note', render: (row) => row.note || '—' },
          ],
          rows: records,
          empty: 'No attendance has been recorded for this day yet.',
        })
      : ui.emptyState('Nothing recorded for this day yet.'),
  });
}

async function loadHistory(user) {
  const to = ui.today();
  const from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const data = await api.get('/attendance/summary', { from, to });
  return data.days || [];
}

function historyTable(days) {
  return ui.table({
    columns: [
      { header: 'Day', render: (row) => ui.fmtDate(row.date) },
      { header: 'Present', render: (row) => row.present || 0 },
      { header: 'Late', render: (row) => row.late || 0 },
      { header: 'Absent', render: (row) => row.absent || 0 },
      { header: 'Sick', render: (row) => row.sick || 0 },
    ],
    rows: days,
    empty: 'No attendance records in this period.',
  });
}

/* --------------------------------------------------------------------- staff */

function registerCard({ children, records, date, classroomId, ctx }) {
  const list = children.filter(
    (child) => !classroomId || String(child.classroomId) === String(classroomId),
  );
  const existing = new Map(records.map((row) => [Number(row.childId), row]));
  const draft = new Map();

  if (!list.length) {
    return ui.card({
      title: 'Quick register',
      body: ui.emptyState('No children match this filter.', {
        hint: 'Try “All classrooms”, or enrol a child first.',
      }),
    });
  }

  const pipsByChild = new Map();
  const timeByChild = new Map();

  function refreshPips(childId) {
    const status = draft.get(childId)?.status;
    for (const pip of pipsByChild.get(childId) || []) {
      pip.classList.toggle('is-on', pip.dataset.status === status);
    }
  }

  function setStatus(childId, status) {
    const entry = draft.get(childId) || {};
    entry.status = status;
    draft.set(childId, entry);
    if (status === 'present' && !entry.checkInTime) {
      entry.checkInTime = timeByChild.get(childId)?.value || '';
    }
    refreshPips(childId);
  }

  const SCROLL_AFTER = 10;
  const scrolls = list.length > SCROLL_AFTER;

  // One child under another. Past ten children the list scrolls, so the card's
  // "Save register" button stays in reach - and a scrollable region has to be
  // reachable with the keyboard, hence the tabindex and the group label.
  const rows = ui.el('div', {
    class: scrolls ? 'attendance-list is-scrollable' : 'attendance-list',
    tabindex: scrolls ? 0 : undefined,
    role: scrolls ? 'group' : undefined,
    'aria-label': scrolls ? `Quick register: ${list.length} children` : undefined,
  });

  for (const child of list) {
    const childId = Number(child.id);
    const record = existing.get(childId);
    if (record) {
      draft.set(childId, { status: record.status, checkInTime: timeValue(record.checkInTime) });
    }

    const timeInput = ui.el('input', {
      class: 'input',
      type: 'time',
      value: timeValue(record?.checkInTime),
      title: 'Arrival time',
    });
    timeInput.addEventListener('change', () => {
      const entry = draft.get(childId) || {};
      entry.checkInTime = timeInput.value;
      draft.set(childId, entry);
    });
    timeByChild.set(childId, timeInput);

    const pips = STATUSES.map((status) =>
      ui.el('button', {
        class: 'status-pip',
        type: 'button',
        text: status.short,
        title: status.label,
        dataset: { status: status.value },
        onClick: () => setStatus(childId, status.value),
      }),
    );
    pipsByChild.set(childId, pips);
    refreshPips(childId);

    rows.append(
      ui.el(
        'div',
        { class: 'attendance-row' },
        ui.el(
          'div',
          {},
          ui.el('strong', { text: `${child.firstName} ${child.lastName}` }),
          ui.el('p', { class: 'muted small', text: child.classroomName || store.classroomName(child.classroomId) || 'No classroom' }),
        ),
        ui.el('div', { class: 'status-pips' }, pips),
        timeInput,
      ),
    );
  }

  const saveButton = ui.button('Save register', {
    onClick: async () => {
      const entries = [];
      for (const [childId, entry] of draft) {
        if (!entry.status) continue;
        entries.push(
          ui.compact({ childId, status: entry.status, checkInTime: entry.checkInTime, date }),
        );
      }
      if (!entries.length) {
        ui.notify.info('Choose a status for at least one child first.');
        return;
      }
      saveButton.disabled = true;
      try {
        const result = await api.post('/attendance/bulk', { date, entries });
        ui.notify.ok(`${result.saved} attendance record(s) saved.`);
        ctx.go('/attendance', ui.compact({ date, classroomId }));
      } catch (error) {
        ui.notify.error(error.message);
      } finally {
        saveButton.disabled = false;
      }
    },
  });

  const markAll = (status) => {
    for (const child of list) setStatus(Number(child.id), status);
  };

  return ui.card({
    title: 'Quick register',
    subtitle: `${list.length} child(ren) · ${ui.fmtDate(date)} · saved with one request`,
    actions: [
      ui.button('All present', { kind: 'ghost', onClick: () => markAll('present') }),
      ui.button('All absent', { kind: 'ghost', onClick: () => markAll('absent') }),
      ui.button('Clear', {
        kind: 'ghost',
        onClick: () => {
          draft.clear();
          for (const child of list) {
            const childId = Number(child.id);
            timeByChild.get(childId).value = '';
            refreshPips(childId);
          }
        },
      }),
      saveButton,
    ],
    body: ui.el(
      'div',
      { class: 'stack' },
      ui.el('p', {
        class: 'muted small',
        text:
          'Click a letter to set the status: P present · L late · A absent · S sick · H holiday.' +
          (scrolls ? ' Scroll the list to reach every child.' : ''),
      }),
      rows,
    ),
  });
}

function historyCard({ ctx }) {
  const button = ui.button('Load last 30 days', {
    kind: 'ghost',
    onClick: async () => {
      const days = await loadHistory(ctx.user);
      ui.mount(box, historyTable(days));
    },
  });
  const box = ui.el('div', {}, ui.emptyState('Open the 30-day overview to spot patterns.'));
  return ui.card({
    title: 'Attendance history',
    subtitle: 'Whole centre, grouped per day (scoped to your classrooms)',
    actions: button,
    body: box,
  });
}
