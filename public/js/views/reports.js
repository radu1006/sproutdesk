'use strict';

/**
 * Daily reports: one sheet per child per day (mood, meals, nap, activities,
 * toileting). Educators write them, families read the sheets of their children.
 */

import { api } from '../api.js';
import * as store from '../state.js';
import * as ui from '../ui.js';

const MOODS = ['happy', 'calm', 'tired', 'upset', 'energetic'];
const MEALS = ['all', 'most', 'some', 'none'];
const MEAL_FIELDS = [
  ['breakfast', 'Breakfast'],
  ['lunch', 'Lunch'],
  ['snack', 'Snack'],
];
const MOOD_TONES = {
  happy: 'success',
  calm: 'info',
  tired: 'warn',
  upset: 'danger',
  energetic: 'info',
};

const options = (values) => values.map((value) => ({ value, label: ui.label(value) }));

/** ISO date `days` away from today, used for the family date range. */
function shiftDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

/** Child picker, shortened to one classroom when the user filtered by room. */
function childPicker(children, { value, name = 'childId', classroomId } = {}) {
  const rows = classroomId
    ? children.filter((child) => String(child.classroomId ?? '') === String(classroomId))
    : children;
  return ui.select({
    name,
    value,
    required: true,
    placeholder: 'Select a child',
    options: rows.map((child) => ({
      value: String(child.id),
      label: child.classroomName ? `${child.fullName} (${child.classroomName})` : child.fullName,
    })),
  });
}

/** Create / edit dialog. Editing keeps the original child and date. */
function reportDialog({ report, children, date, classroomId, onSaved }) {
  const editing = Boolean(report);
  const element = ui.form(
    [
      ui.field(
        'Child',
        editing
          ? ui.el('strong', { text: `${report.childName} - ${ui.fmtDate(report.date, { weekday: false })}` })
          : childPicker(children, { value: '', classroomId }),
      ),
      ui.field(
        'Date',
        ui.input({ name: 'date', type: 'date', value: report?.date || date, disabled: editing }),
      ),
      ui.field(
        'Mood',
        ui.select({ name: 'mood', value: report?.mood || '', options: options(MOODS), placeholder: 'Not recorded' }),
      ),
      ...MEAL_FIELDS.map(([name, caption]) =>
        ui.field(
          caption,
          ui.select({
            name,
            value: report?.[name] || '',
            options: options(MEALS),
            placeholder: 'Not recorded',
          }),
        ),
      ),
      ui.field(
        'Nap (minutes)',
        ui.input({ name: 'napMinutes', type: 'number', min: 0, max: 720, value: report?.napMinutes ?? '' }),
      ),
      ui.field(
        'Toileting',
        ui.input({ name: 'toiletNotes', value: report?.toiletNotes || '', placeholder: 'Nappy changes, toilet visits' }),
      ),
      ui.field(
        'Activities',
        ui.textarea({ name: 'activities', value: report?.activities || '', rows: 2, placeholder: 'Painting, story time, garden' }),
      ),
      ui.field('Note for the family', ui.textarea({ name: 'teacherNote', value: report?.teacherNote || '', rows: 3 })),
    ],
    {
      submitLabel: editing ? 'Update sheet' : 'Save sheet',
      cancel: ui.closeModal,
      onSubmit: async (values) => {
        const payload = ui.compact({
          ...values,
          childId: editing ? report.childId : Number(values.childId),
          date: report?.date || values.date,
        });
        const data = await api.put('/daily-reports', payload);
        ui.notify.ok(data?.created ? 'Daily sheet created.' : 'Daily sheet updated.');
        ui.closeModal();
        onSaved();
      },
    },
  );

  ui.openModal({
    title: editing ? `Daily sheet - ${report.childName}` : 'New daily sheet',
    body: element,
  });
}

/** Table used by staff: one row per child, with edit and delete actions. */
function sheetTable({ rows, children, date, classroomId, reload }) {
  return ui.table({
    columns: [
      {
        header: 'Child',
        render: (row) =>
          ui.el(
            'div',
            { class: 'stack' },
            ui.el('strong', { text: row.childName }),
            ui.el('span', { class: 'muted small', text: ui.fmtDate(row.date, { weekday: false }) }),
          ),
      },
      {
        header: 'Mood',
        render: (row) =>
          row.mood ? ui.badge(ui.label(row.mood), MOOD_TONES[row.mood] || 'neutral') : ui.el('span', { class: 'muted', text: 'Not set' }),
      },
      {
        header: 'Meals',
        render: (row) =>
          ui.pills(
            MEAL_FIELDS.map(([name, caption]) => `${caption}: ${row[name] ? ui.label(row[name]) : '-'}`),
          ),
      },
      {
        header: 'Nap',
        render: (row) => (row.napMinutes === null || row.napMinutes === undefined ? '-' : `${row.napMinutes} min`),
      },
      { header: 'Activities', render: (row) => ui.el('span', { text: row.activities || '-' }) },
      {
        header: 'Note',
        render: (row) => ui.el('span', { class: 'muted', text: row.teacherNote || '-' }),
      },
      {
        header: '',
        class: 'right',
        render: (row) =>
          ui.el(
            'div',
            { class: 'row' },
            ui.button('Edit', {
              kind: 'ghost',
              onClick: () => reportDialog({ report: row, children, date, classroomId, onSaved: reload }),
            }),
            ui.button('Delete', {
              kind: 'danger',
              onClick: async () => {
                const confirmed = await ui.confirmAction(`Delete the daily sheet of ${row.childName}?`);
                if (!confirmed) return;
                await api.delete(`/daily-reports/${row.id}`);
                ui.notify.ok('Daily sheet deleted.');
                reload();
              },
            }),
          ),
      },
    ],
    rows,
    empty: `No daily sheets for ${ui.fmtDate(date)} yet.`,
  });
}

/** Read-only cards for families. */
function familySheets(rows) {
  if (!rows.length) {
    return ui.emptyState('No daily sheets in this period.', {
      hint: 'Every sheet your child gets appears here the moment it is written.',
    });
  }
  return ui.el(
    'div',
    { class: 'grid grid-2' },
    rows.map((row) =>
      ui.card({
        title: `${row.childName} - ${ui.fmtDate(row.date)}`,
        subtitle: row.mood ? `Mood: ${ui.label(row.mood)}` : 'Mood not recorded',
        body: ui.definitionList([
          ...MEAL_FIELDS.map(([name, caption]) => [caption, row[name] ? ui.label(row[name]) : '-']),
          ['Nap', row.napMinutes === null || row.napMinutes === undefined ? '-' : `${row.napMinutes} minutes`],
          ['Toileting', row.toiletNotes],
          ['Activities', row.activities],
          ['Note', row.teacherNote],
        ]),
      }),
    ),
  );
}

export default async function renderReports(container, ctx) {
  const isStaff = ctx.user.role !== 'parent';
  const date = ctx.query.date || ui.today();
  const classroomId = ctx.query.classroomId || '';
  const period = ui.compact({ from: ctx.query.from, to: ctx.query.to });

  const [children, response] = await Promise.all([
    isStaff ? store.loadChildren({ force: true }) : Promise.resolve([]),
    isStaff
      ? api.get('/daily-reports', ui.compact({ date, classroomId }))
      : api.get(
          '/daily-reports',
          Object.keys(period).length ? period : { from: shiftDays(-29), to: ui.today() },
        ),
  ]);
  const sheets = Array.isArray(response) ? response : [];

  const reload = () => ctx.go('/reports', ui.compact({ date, classroomId }));
  const active = children.filter((child) => child.enrollmentStatus !== 'archived');
  const missing =
    isStaff && !classroomId
      ? active.filter((child) => !sheets.some((row) => Number(row.childId) === Number(child.id)))
      : [];

  const dateInput = ui.input({ name: 'date', type: 'date', value: date });
  const classroomSelect = isStaff
    ? ui.select({
        name: 'classroomId',
        value: classroomId,
        options: store.classroomOptions({ includeAll: true }),
      })
    : null;

  const stats = ui.el(
    'div',
    { class: 'stats' },
    ui.stat(sheets.length, isStaff ? 'sheets for the day' : 'sheets in range'),
    isStaff ? ui.stat(active.length, 'children enrolled') : null,
    isStaff ? ui.stat(missing.length, 'without a sheet', { tone: missing.length ? 'warn' : 'neutral' }) : null,
  );

  const bar = ui.toolbar(
    isStaff ? ui.field('Date', dateInput) : null,
    classroomSelect ? ui.field('Classroom', classroomSelect) : null,
    isStaff
      ? ui.button('Load', {
          kind: 'ghost',
          onClick: () =>
            ctx.go('/reports', ui.compact({ date: dateInput.value || ui.today(), classroomId: classroomSelect.value })),
        })
      : null,
    isStaff
      ? ui.button('New sheet', {
          onClick: () => reportDialog({ children: active, date, classroomId, onSaved: reload }),
        })
      : null,
  );

  ui.mount(
    container,
    stats,
    bar,
    ui.card({
      title: isStaff ? 'Daily sheets' : 'My children\'s daily sheets',
      subtitle: isStaff
        ? ui.fmtDate(date)
        : `${ui.fmtDate(period.from || shiftDays(-29), { weekday: false })} to ${ui.fmtDate(period.to || ui.today(), { weekday: false })}`,
      body: isStaff
        ? sheetTable({ rows: sheets, children: active, date, classroomId, reload })
        : familySheets(sheets),
    }),
    isStaff && missing.length
      ? ui.card({
          title: 'Still without a sheet today',
          subtitle: 'Click a child to write the missing sheet.',
          body: ui.pills(missing.map((child) => child.fullName)),
        })
      : null,
  );
}
