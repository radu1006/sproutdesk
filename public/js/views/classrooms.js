'use strict';

/**
 * Classroom management. Administrators create and edit rooms and pick the lead
 * educator; every member of staff can open a room and see who is enrolled.
 */

import { api } from '../api.js';
import * as store from '../state.js';
import * as ui from '../ui.js';

const AGE_GROUPS = ['Infants', 'Toddlers', 'Preschool', 'Pre-K', 'Kindergarten', 'Mixed ages'];
const USAGE_TONES = { full: 'warn', near: 'info', open: 'success' };

const ageGroupOptions = () => AGE_GROUPS.map((value) => ({ value, label: value }));

/** Seats used out of capacity, as a small bar plus a caption. */
function seatMeter(childCount, capacity) {
  const total = Number(capacity) || 0;
  const used = Number(childCount) || 0;
  const percent = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const tone = percent >= 95 ? 'full' : percent >= 80 ? 'near' : 'open';

  return ui.el(
    'div',
    { class: 'stack' },
    ui.el(
      'div',
      { class: 'meter' },
      ui.el('span', {
        class: `meter-fill meter-${tone}`,
        style: `width:${percent}%`,
        title: `${used} of ${total} places used`,
      }),
    ),
    ui.el('span', { class: 'muted small', text: `${used} of ${total} places used · ${percent}%` }),
  );
}

/** Create (admin) or edit (admin) a classroom. */
function classroomDialog({ classroom, teachers, onSaved }) {
  const editing = Boolean(classroom);
  const element = ui.form(
    [
      ui.field('Name', ui.input({ name: 'name', value: classroom?.name || '', required: true, maxlength: 80 })),
      ui.field(
        'Age group',
        ui.select({
          name: 'ageGroup',
          value: classroom?.ageGroup || '',
          placeholder: 'Not set',
          options: ageGroupOptions(),
        }),
      ),
      ui.field('Capacity', ui.input({ name: 'capacity', type: 'number', min: 1, max: 200, value: classroom?.capacity ?? 20 })),
      ui.field('Room', ui.input({ name: 'roomLabel', value: classroom?.roomLabel || '', placeholder: 'Sunflower room' })),
      ui.field(
        'Lead educator',
        ui.select({
          name: 'leadTeacherId',
          value: classroom?.leadTeacherId ?? '',
          placeholder: 'Not assigned',
          options: teachers.map((row) => ({ value: String(row.id), label: row.fullName })),
        }),
      ),
      ui.field('Notes', ui.textarea({ name: 'notes', value: classroom?.notes || '', rows: 3 })),
    ],
    {
      submitLabel: editing ? 'Save changes' : 'Add classroom',
      cancel: ui.closeModal,
      onSubmit: async (values) => {
        const payload = ui.compact({
          ...values,
          capacity: values.capacity === '' ? undefined : Number(values.capacity),
          leadTeacherId: values.leadTeacherId ? Number(values.leadTeacherId) : undefined,
        });
        if (editing) await api.patch(`/classrooms/${classroom.id}`, payload);
        else await api.post('/classrooms', payload);
        await store.loadClassrooms({ force: true });
        ui.notify.ok(editing ? 'Classroom updated.' : 'Classroom added.');
        ui.closeModal();
        onSaved();
      },
    },
  );

  ui.openModal({ title: editing ? `Edit ${classroom.name}` : 'New classroom', body: element });
}


/** Roster of one classroom, loaded on demand. */
async function rosterDialog({ classroom, onOpenChildren }) {
  const box = ui.openModal({
    title: `${classroom.name} · roster`,
    body: ui.loading('Loading the roster…'),
  });
  const body = box.querySelector('.modal-body');

  try {
    const data = await api.get(`/classrooms/${classroom.id}`);
    const roster = data.roster || [];
    const columns = [
      { header: 'Child', render: (row) => row.fullName },
      {
        header: 'Date of birth',
        render: (row) => (row.dateOfBirth ? ui.fmtDate(row.dateOfBirth, { weekday: false }) : '—'),
      },
      {
        header: 'Status',
        render: (row) => ui.badge(ui.label(row.enrollmentStatus), row.enrollmentStatus === 'active' ? 'success' : 'warn'),
      },
      { header: 'Allergies', render: (row) => row.allergies || '—' },
    ];
    ui.mount(
      body,
      ui.el(
        'div',
        { class: 'stack' },
        ui.el(
          'div',
          { class: 'stats' },
          ui.stat(roster.length, 'children'),
          ui.stat(data.classroom.capacity, 'places'),
          ui.stat(Math.max(0, data.classroom.capacity - roster.length), 'places free', { tone: 'info' }),
        ),
        ui.table({ columns, rows: roster, empty: 'No children enrolled in this classroom yet.' }),
        onOpenChildren
          ? ui.el('div', { class: 'form-actions' }, ui.button('Open the children roster', { kind: 'ghost', onClick: onOpenChildren }))
          : null,
      ),
    );
  } catch (error) {
    ui.mount(body, ui.errorState(error));
  }
}

/** One room as a card: occupancy, lead educator and the available actions. */
function classroomCard({ classroom, isAdmin, teachers, onSaved, onOpenChildren }) {
  const atCapacity = (Number(classroom.childCount) || 0) >= Number(classroom.capacity);
  return ui.card({
    title: classroom.name,
    subtitle: [classroom.ageGroup, classroom.roomLabel].filter(Boolean).join(' · ') || 'No age group set',
    actions: ui.badge(
      atCapacity ? 'At capacity' : `${classroom.childCount ?? 0} enrolled`,
      atCapacity ? USAGE_TONES.full : USAGE_TONES.open,
    ),
    body: ui.el(
      'div',
      { class: 'stack' },
      seatMeter(classroom.childCount, classroom.capacity),
      ui.definitionList([
        ['Lead educator', classroom.leadTeacherName],
        ['Room', classroom.roomLabel],
        ['Notes', classroom.notes],
      ]),
      ui.el(
        'div',
        { class: 'row' },
        ui.button('View roster', { kind: 'ghost', onClick: () => rosterDialog({ classroom, onOpenChildren }) }),
        isAdmin
          ? ui.button('Edit', { kind: 'ghost', onClick: () => classroomDialog({ classroom, teachers, onSaved }) })
          : null,
        isAdmin
          ? ui.button('Delete', {
              kind: 'danger',
              onClick: async () => {
                const confirmed = await ui.confirmAction(
                  `Delete ${classroom.name}? A classroom with children cannot be deleted.`,
                );
                if (!confirmed) return;
                try {
                  await api.delete(`/classrooms/${classroom.id}`);
                  await store.loadClassrooms({ force: true });
                  ui.notify.ok('Classroom removed.');
                  onSaved();
                } catch (error) {
                  ui.notify.error(error.message);
                }
              },
            })
          : null,
      ),
    ),
  });
}

export default async function renderClassrooms(container, ctx) {
  const isAdmin = ctx.user.role === 'admin';

  async function loadTeachers() {
    if (!isAdmin) return [];
    try {
      return await api.get('/users', { role: 'teacher' });
    } catch {
      return [];
    }
  }

  async function draw() {
    ui.mount(container, ui.loading('Loading classrooms…'));
    try {
      const classrooms = await store.loadClassrooms({ force: true });
      const children = classrooms.reduce((total, row) => total + (Number(row.childCount) || 0), 0);
      const capacity = classrooms.reduce((total, row) => total + (Number(row.capacity) || 0), 0);
      const teachers = await loadTeachers();

      const add = isAdmin ? () => classroomDialog({ teachers, onSaved: () => draw() }) : null;
      ctx.setActions(add ? ui.button('Add classroom', { onClick: add }) : null);

      ui.mount(
        container,
        ui.el(
          'div',
          { class: 'stack' },
          ui.el(
            'div',
            { class: 'stats' },
            ui.stat(classrooms.length, 'classrooms', { tone: 'info' }),
            ui.stat(children, 'children placed', { tone: 'success' }),
            ui.stat(capacity, 'licensed places'),
            ui.stat(Math.max(0, capacity - children), 'places free', { tone: 'warn' }),
          ),
          classrooms.length
            ? ui.el(
                'div',
                { class: 'grid grid-2' },
                classrooms.map((classroom) =>
                  classroomCard({
                    classroom,
                    isAdmin,
                    teachers,
                    onSaved: () => draw(),
                    onOpenChildren: () => {
                      ui.closeModal();
                      ctx.go('/children', { classroomId: String(classroom.id) });
                    },
                  }),
                ),
              )
            : ui.emptyState('No classrooms yet.', {
                hint: isAdmin
                  ? 'Use the “Add classroom” button to create the first room.'
                  : 'An administrator creates classrooms.',
              }),
        ),
      );
    } catch (error) {
      ui.mount(container, ui.errorState(error));
    }
  }

  await draw();
}

