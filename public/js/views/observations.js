'use strict';

/**
 * Observations: short developmental notes per child and area. Educators log
 * them; families see what has been recorded for their own children, together
 * with the latest level reached in every development area.
 */

import { api } from '../api.js';
import * as store from '../state.js';
import * as ui from '../ui.js';

const AREAS = ['language', 'motor', 'social', 'cognitive', 'creative', 'self_care'];
const LEVELS = ['emerging', 'developing', 'secure'];
const LEVEL_TONES = { emerging: 'warn', developing: 'info', secure: 'success' };

const options = (values) => values.map((value) => ({ value, label: ui.label(value) }));

function shiftDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

/** Create / edit dialog for one observation. */
function observationDialog({ observation, childId, children, onSaved }) {
  const editing = Boolean(observation);
  const element = ui.form(
    [
      ui.field(
        'Child',
        editing
          ? ui.el('strong', { text: observation.childName })
          : store.childOptions().length
            ? ui.select({
                name: 'childId',
                value: childId,
                required: true,
                placeholder: 'Select a child',
                options: store.childOptions(),
              })
            : ui.input({ name: 'childId', type: 'number', min: 1, required: true, placeholder: 'Child id' }),
      ),
      ui.field('Area', ui.select({ name: 'area', value: observation?.area || '', options: options(AREAS), required: true, placeholder: 'Select an area' })),
      ui.field('Level', ui.select({ name: 'level', value: observation?.level || '', options: options(LEVELS), required: true, placeholder: 'Select a level' })),
      ui.field('Observed on', ui.input({ name: 'observedOn', type: 'date', value: observation?.observedOn || ui.today(), required: true })),
      ui.field('What did you notice?', ui.textarea({ name: 'note', value: observation?.note || '', rows: 5, required: true, placeholder: 'Describe the moment and what the child did.' })),
    ],
    {
      submitLabel: editing ? 'Update observation' : 'Save observation',
      cancel: ui.closeModal,
      onSubmit: async (values) => {
        const payload = ui.compact({
          area: values.area,
          level: values.level,
          observedOn: values.observedOn,
          note: values.note,
        });
        if (editing) await api.patch(`/observations/${observation.id}`, payload);
        else await api.post('/observations', { ...payload, childId: Number(values.childId) });
        ui.notify.ok(editing ? 'Observation updated.' : 'Observation saved.');
        ui.closeModal();
        onSaved();
      },
    },
  );

  ui.openModal({
    title: editing ? `Observation - ${observation.childName}` : 'New observation',
    body: element,
  });
}

/** Latest level per development area, shown as a small key/value list. */
function progressCard({ childName, areas }) {
  return ui.card({
    title: `Development areas - ${childName}`,
    subtitle: 'Most recent level recorded for each area',
    body: ui.el(
      'div',
      { class: 'stack' },
      areas.map((entry) =>
        ui.el(
          'div',
          { class: 'attendance-row' },
          ui.el('span', { text: ui.label(entry.area) }),
          entry.level
            ? ui.badge(`${ui.label(entry.level)}${entry.observedOn ? ` - ${ui.fmtDate(entry.observedOn, { weekday: false })}` : ''}`, LEVEL_TONES[entry.level] || 'neutral')
            : ui.el('span', { class: 'muted small', text: 'Not recorded yet' }),
        ),
      ),
    ),
  });
}

function observationTable({ rows, children, reload }) {
  return ui.table({
    columns: [
      {
        header: 'Child',
        render: (row) =>
          ui.el(
            'div',
            { class: 'stack' },
            ui.el('strong', { text: row.childName }),
            ui.el('span', { class: 'muted small', text: ui.fmtDate(row.observedOn, { weekday: false }) }),
          ),
      },
      { header: 'Area', render: (row) => ui.badge(ui.label(row.area), 'neutral') },
      { header: 'Level', render: (row) => ui.badge(ui.label(row.level), LEVEL_TONES[row.level] || 'neutral') },
      { header: 'Note', render: (row) => ui.el('span', { text: row.note || '-' }) },
      {
        header: 'Author',
        render: (row) => ui.el('span', { class: 'muted small', text: row.createdByName || '-' }),
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
              onClick: () => observationDialog({ observation: row, children, onSaved: reload }),
            }),
            ui.button('Delete', {
              kind: 'danger',
              onClick: async () => {
                const confirmed = await ui.confirmAction(`Delete this ${ui.label(row.area)} observation of ${row.childName}?`);
                if (!confirmed) return;
                await api.delete(`/observations/${row.id}`);
                ui.notify.ok('Observation deleted.');
                reload();
              },
            }),
          ),
      },
    ],
    rows,
    empty: 'No observations in this period.',
  });
}

function familyObservations(rows) {
  if (!rows.length) {
    return ui.emptyState('Nothing recorded in this period.', {
      hint: 'Observations appear here as soon as an educator writes one.',
    });
  }
  return ui.el(
    'div',
    { class: 'grid grid-2' },
    rows.map((row) =>
      ui.card({
        title: `${row.childName} - ${ui.label(row.area)}`,
        subtitle: `${ui.fmtDate(row.observedOn, { weekday: false })} - ${ui.label(row.level)}`,
        body: ui.el(
          'div',
          { class: 'stack' },
          ui.el('p', { text: row.note || '-' }),
          ui.el('p', { class: 'muted small', text: row.createdByName ? `Recorded by ${row.createdByName}` : '' }),
        ),
      }),
    ),
  );
}

export default async function renderObservations(container, ctx) {
  const isStaff = ctx.user.role !== 'parent';
  const childId = ctx.query.childId || '';
  const area = ctx.query.area || '';
  const from = ctx.query.from || shiftDays(-89);
  const to = ctx.query.to || ui.today();

  const children = await store.loadChildren({ force: true });
  const progressIds = isStaff
    ? childId
      ? [Number(childId)]
      : []
    : children.map((child) => Number(child.id));

  const [response, progress] = await Promise.all([
    api.get('/observations', ui.compact({ childId, area, from, to, limit: 200 })),
    Promise.all(
      progressIds.map(async (id) => {
        const data = await api.get(`/observations/progress/${id}`);
        const child = children.find((row) => Number(row.id) === id);
        return { childId: id, childName: child ? child.fullName : `Child #${id}`, areas: data.areas || [] };
      }),
    ),
  ]);
  const rows = Array.isArray(response) ? response : [];

  const reload = () => ctx.go('/observations', ui.compact({ childId, area, from, to }));

  const stats = ui.el(
    'div',
    { class: 'stats' },
    ui.stat(rows.length, 'observations'),
    ui.stat(new Set(rows.map((row) => Number(row.childId))).size, 'children covered'),
    ui.stat(rows.length ? ui.label(rows[0].level) : '-', 'latest level'),
  );

  const childSelect = ui.select({
    name: 'childId',
    value: childId,
    placeholder: 'All children',
    options: store.childOptions(),
  });
  const areaSelect = ui.select({
    name: 'area',
    value: area,
    placeholder: 'All areas',
    options: options(AREAS),
  });
  const fromInput = ui.input({ name: 'from', type: 'date', value: from });
  const toInput = ui.input({ name: 'to', type: 'date', value: to });

  const bar = ui.toolbar(
    isStaff ? ui.field('Child', childSelect) : null,
    ui.field('Area', areaSelect),
    isStaff ? ui.field('From', fromInput) : null,
    isStaff ? ui.field('To', toInput) : null,
    ui.button('Load', {
      kind: 'ghost',
      onClick: () =>
        ctx.go(
          '/observations',
          ui.compact({ childId: childSelect.value, area: areaSelect.value, from: fromInput.value, to: toInput.value }),
        ),
    }),
    isStaff
      ? ui.button('New observation', {
          onClick: () => observationDialog({ childId, children, onSaved: reload }),
        })
      : null,
  );

  ui.mount(
    container,
    stats,
    bar,
    isStaff
      ? ui.card({
          title: 'Observation log',
          subtitle: `${ui.fmtDate(from, { weekday: false })} to ${ui.fmtDate(to, { weekday: false })}`,
          body: observationTable({ rows, children, reload }),
        })
      : ui.card({
          title: 'Observations',
          subtitle: 'What the team noticed about your children',
          body: familyObservations(rows),
        }),
    ...progress.map((entry) => progressCard(entry)),
  );
}
