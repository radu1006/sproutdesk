'use strict';

/**
 * Calendar: centre-wide and classroom events in an agenda grouped by day.
 * Educators create events for their own classrooms, administrators for anyone.
 */

import { api } from '../api.js';
import * as store from '../state.js';
import * as ui from '../ui.js';

const AUDIENCES = ['all', 'teachers', 'parents'];
const audienceOptions = () => AUDIENCES.map((value) => ({ value, label: ui.label(value) }));

/** ISO timestamp -> value understood by `<input type="datetime-local">`. */
function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/** Shifts a YYYY-MM-DD string by whole days without timezone surprises. */
function shiftDay(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const dayKey = (value) => (value ? String(value).slice(0, 10) : '');

/** "2026-09-26" -> "Sep". */
function monthShort(isoDate) {
  const label = ui.fmtDate(isoDate, { weekday: false });
  const parts = String(label).split(' ');
  return parts.length > 1 ? parts[1] : '';
}

/** Create or edit an event. */
function eventDialog({ event, user, onSaved }) {
  const editing = Boolean(event);
  const isTeacher = user.role === 'teacher';

  const element = ui.form(
    [
      ui.field('Title', ui.input({ name: 'title', value: event?.title || '', required: true, maxlength: 160 })),
      ui.field('Starts', ui.input({ name: 'startsAt', type: 'datetime-local', value: toLocalInput(event?.startsAt), required: true })),
      ui.field('Ends', ui.input({ name: 'endsAt', type: 'datetime-local', value: toLocalInput(event?.endsAt) }), 'Optional.'),
      ui.checkbox({ name: 'allDay', checked: Boolean(event?.allDay), label: 'All-day event' }),
      ui.field(
        'Classroom',
        ui.select({
          name: 'classroomId',
          value: event?.classroomId ?? '',
          placeholder: isTeacher ? 'Select a classroom' : 'Whole centre',
          options: store.classroomOptions(),
          required: isTeacher,
        }),
      ),
      ui.field(
        'Audience',
        ui.select({ name: 'audience', value: event?.audience || 'all', options: audienceOptions(), required: true }),
      ),
      ui.field('Location', ui.input({ name: 'location', value: event?.location || '', maxlength: 160, placeholder: 'Sunflower room' })),
      ui.field('Details', ui.textarea({ name: 'description', value: event?.description || '', rows: 4 })),
    ],
    {
      submitLabel: editing ? 'Save changes' : 'Add event',
      cancel: ui.closeModal,
      onSubmit: async (values) => {
        const payload = ui.compact({
          title: values.title,
          description: values.description,
          location: values.location,
          startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : undefined,
          endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : undefined,
          allDay: Boolean(values.allDay),
          audience: values.audience,
          classroomId: values.classroomId ? Number(values.classroomId) : undefined,
        });
        if (editing) {
          await api.patch(`/events/${event.id}`, {
            ...payload,
            classroomId: values.classroomId ? Number(values.classroomId) : null,
          });
        } else {
          await api.post('/events', payload);
        }
        ui.notify.ok(editing ? 'Event updated.' : 'Event added to the calendar.');
        ui.closeModal();
        onSaved();
      },
    },
  );

  ui.openModal({ title: editing ? 'Edit event' : 'New event', body: element });
}

/** Short local time, e.g. "9:15 am". */
function fmtTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Agenda row for one event. */
function eventRow({ event, user, onChanged }) {
  const canManage = user.role === 'admin' || Number(event.createdBy) === Number(user.id);
  const when = event.allDay
    ? 'All day'
    : [fmtTime(event.startsAt), event.endsAt ? fmtTime(event.endsAt) : null].filter(Boolean).join(' – ');
  const classroom = event.classroomId ? store.classroomName(event.classroomId) : 'Whole centre';
  const place = [classroom, event.location].filter(Boolean).join(' · ');
  const key = dayKey(event.startsAt);

  return ui.el(
    'div',
    { class: 'event-item' },
    ui.el(
      'div',
      { class: 'event-date' },
      ui.el('strong', { text: key.slice(8, 10) }),
      ui.el('small', { text: monthShort(key) }),
    ),
    ui.el(
      'div',
      { class: 'stack' },
      ui.el('div', { class: 'row' }, ui.el('strong', { text: event.title }), ui.badge(ui.label(event.audience), 'neutral')),
      ui.el('div', { class: 'muted small', text: [when, place].filter(Boolean).join(' · ') }),
      event.description ? ui.el('p', { class: 'post-body', text: event.description }) : null,
      canManage
        ? ui.el(
            'div',
            { class: 'row' },
            ui.button('Edit', { kind: 'ghost', onClick: () => eventDialog({ event, user, onSaved: () => onChanged() }) }),
            ui.button('Delete', {
              kind: 'danger',
              onClick: async () => {
                const confirmed = await ui.confirmAction(`Delete “${event.title}”?`);
                if (!confirmed) return;
                try {
                  await api.delete(`/events/${event.id}`);
                  ui.notify.ok('Event deleted.');
                  onChanged();
                } catch (error) {
                  ui.notify.error(error.message);
                }
              },
            }),
          )
        : null,
    ),
  );
}

export default async function renderEvents(container, ctx) {
  const user = ctx.user;
  const isStaff = user.role !== 'parent';
  const today = ui.today();
  const filters = {
    from: ctx.query.from || shiftDay(today, -30),
    to: ctx.query.to || shiftDay(today, 60),
  };

  if (isStaff) await store.loadClassrooms().catch(() => {});

  const pushQuery = () => ctx.go('/events', { from: filters.from, to: filters.to });

  const moveWindow = (days) => {
    filters.from = shiftDay(filters.from, days);
    filters.to = shiftDay(filters.to, days);
    pushQuery();
  };

  async function draw() {
    ui.mount(container, ui.loading('Loading the calendar…'));
    try {
      const rows = await api.get('/events', { from: filters.from, to: filters.to, limit: 200 });
      const now = Date.now();
      const upcoming = rows.filter((row) => Date.parse(row.startsAt) >= now).length;

      ctx.setActions(
        isStaff ? [ui.button('New event', { onClick: () => eventDialog({ user, onSaved: () => draw() }) })] : null,
      );

      const rangeBox = ui.el(
        'div',
        { class: 'grid grid-2' },
        ui.field('From', ui.input({ name: 'from', type: 'date', value: filters.from })),
        ui.field('To', ui.input({ name: 'to', type: 'date', value: filters.to })),
      );
      for (const node of rangeBox.querySelectorAll('input')) {
        node.addEventListener('change', () => {
          const values = ui.formValues(rangeBox);
          filters.from = values.from || filters.from;
          filters.to = values.to || filters.to;
          pushQuery();
        });
      }

      const days = new Map();
      for (const event of rows) {
        const key = dayKey(event.startsAt);
        if (!days.has(key)) days.set(key, []);
        days.get(key).push(event);
      }

      const agenda = [...days.entries()].map(([day, dayEvents]) =>
        ui.el(
          'section',
          { class: 'stack' },
          ui.el('h3', { text: ui.fmtDate(day) }),
          ui.el(
            'div',
            { class: 'event-list' },
            dayEvents.map((event) => eventRow({ event, user, onChanged: () => draw() })),
          ),
        ),
      );

      ui.mount(
        container,
        ui.el(
          'div',
          { class: 'stack' },
          ui.el(
            'div',
            { class: 'stats' },
            ui.stat(rows.length, 'events in view', { tone: 'info' }),
            ui.stat(upcoming, 'still to come', { tone: upcoming ? 'success' : 'neutral' }),
            ui.stat(rows.filter((row) => !row.classroomId).length, 'whole-centre'),
          ),
          ui.card({
            title: 'Date range',
            subtitle: `${ui.fmtDate(filters.from)} → ${ui.fmtDate(filters.to)}`,
            actions: [
              ui.button('Earlier', { kind: 'ghost', onClick: () => moveWindow(-30) }),
              ui.button('Today', {
                kind: 'ghost',
                onClick: () => {
                  filters.from = shiftDay(ui.today(), -30);
                  filters.to = shiftDay(ui.today(), 60);
                  pushQuery();
                },
              }),
              ui.button('Later', { kind: 'ghost', onClick: () => moveWindow(30) }),
            ],
            body: rangeBox,
          }),
          agenda.length
            ? ui.el('div', { class: 'stack' }, agenda)
            : ui.emptyState('No events in this range.', {
                hint: isStaff ? 'Add an event, or widen the date range.' : 'Try another range to see what is planned.',
              }),
        ),
      );
    } catch (error) {
      ui.mount(container, ui.errorState(error));
    }
  }

  await draw();
}

