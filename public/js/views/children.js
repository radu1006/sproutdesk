'use strict';

/**
 * Children roster.
 *
 * Administrators keep the full record (enrolment, classroom, guardians);
 * educators may only maintain the wellbeing fields and the photo; families see
 * their own children with the guardians linked to them.
 */

import { api } from '../api.js';
import * as store from '../state.js';
import * as ui from '../ui.js';

const STATUSES = ['active', 'waitlist', 'archived'];
const STATUS_TONES = { active: 'success', waitlist: 'warn', archived: 'neutral' };
const RELATIONSHIPS = ['mother', 'father', 'guardian', 'other'];
const FILTER_STATUSES = [
  { value: '', label: 'All statuses' },
  ...STATUSES.map((value) => ({ value, label: ui.label(value) })),
];

const statusOptions = () => STATUSES.map((value) => ({ value, label: ui.label(value) }));

/** "3 yr 4 mo" from a birth date; blanks when unknown. */
function ageLabel(dateOfBirth) {
  if (!dateOfBirth) return '';
  const born = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(born.getTime())) return '';
  const months = Math.max(0, Math.floor((Date.now() - born.getTime()) / (30.44 * 86400000)));
  const years = Math.floor(months / 12);
  return years ? `${years} yr ${months % 12} mo` : `${months} mo`;
}

const childDisplay = (row) => `${row.firstName} ${row.lastName}`;

/** Create (admin) or edit (admin) dialog. */
function childDialog({ child, onSaved }) {
  const editing = Boolean(child);
  const element = ui.form(
    [
      ui.field('First name', ui.input({ name: 'firstName', value: child?.firstName || '', required: true, maxlength: 60 })),
      ui.field('Last name', ui.input({ name: 'lastName', value: child?.lastName || '', required: true, maxlength: 60 })),
      ui.field('Date of birth', ui.input({ name: 'dateOfBirth', type: 'date', value: child?.dateOfBirth || '', required: true })),
      ui.field('Classroom', ui.select({ name: 'classroomId', value: child?.classroomId ?? '', placeholder: 'Not assigned', options: store.classroomOptions() })),
      ui.field('Enrolment status', ui.select({ name: 'enrollmentStatus', value: child?.enrollmentStatus || 'active', options: statusOptions(), required: true })),
      ui.field('Start date', ui.input({ name: 'startDate', type: 'date', value: child?.startDate || '' })),
      ui.field('Allergies', ui.textarea({ name: 'allergies', value: child?.allergies || '', rows: 2, placeholder: 'Nuts, dairy, medication' })),
      ui.field('Medical notes', ui.textarea({ name: 'medicalNotes', value: child?.medicalNotes || '', rows: 3 })),
    ],
    {
      submitLabel: editing ? 'Save changes' : 'Add child',
      cancel: ui.closeModal,
      onSubmit: async (values) => {
        const payload = ui.compact({
          ...values,
          classroomId: values.classroomId ? Number(values.classroomId) : undefined,
        });
        if (editing) await api.patch(`/children/${child.id}`, payload);
        else await api.post('/children', payload);
        await store.loadChildren({ force: true });
        ui.notify.ok(editing ? 'Child updated.' : 'Child added.');
        ui.closeModal();
        onSaved();
      },
    },
  );

  ui.openModal({ title: editing ? `Edit ${childDisplay(child)}` : 'New child', body: element });
}

/** Educators may only touch wellbeing fields and the photo. */
function wellbeingDialog({ child, onSaved }) {
  const element = ui.form(
    [
      ui.field('Child', ui.el('strong', { text: childDisplay(child) })),
      ui.field('Allergies', ui.textarea({ name: 'allergies', value: child.allergies || '', rows: 2 })),
      ui.field('Medical notes', ui.textarea({ name: 'medicalNotes', value: child.medicalNotes || '', rows: 4 })),
    ],
    {
      submitLabel: 'Save wellbeing notes',
      cancel: ui.closeModal,
      onSubmit: async (values) => {
        await api.patch(`/children/${child.id}`, ui.compact(values));
        ui.notify.ok('Wellbeing notes saved.');
        ui.closeModal();
        onSaved();
      },
    },
  );
  ui.openModal({ title: `Wellbeing - ${childDisplay(child)}`, body: element });
}

/** Photo widget: read-only for families, upload for staff. */
function photoControl({ child, editable, onSaved }) {
  const preview = child.photoUrl
    ? ui.el('img', { class: 'child-photo', src: child.photoUrl, alt: childDisplay(child) })
    : ui.el('span', { class: 'muted small', text: 'No photo on file' });

  if (!editable) return ui.el('div', { class: 'stack' }, preview);

  const input = ui.el('input', {
    class: 'input',
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp,image/gif',
  });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const uploaded = await api.upload('/uploads', file);
      await api.patch(`/children/${child.id}`, { photoUrl: uploaded.url });
      ui.notify.ok('Photo updated.');
      onSaved();
    } catch (error) {
      ui.notify.error(error.message || 'The photo could not be uploaded.');
    } finally {
      input.value = '';
    }
  });

  return ui.el(
    'div',
    { class: 'stack' },
    preview,
    input,
    ui.el('span', { class: 'muted small', text: 'PNG, JPEG, WebP or GIF. Families see this photo.' }),
  );
}

/** Links an existing parent account to the child. */
async function guardianDialog({ child, onSaved }) {
  let parents = [];
  try {
    parents = await api.get('/users', { role: 'parent' });
  } catch {
    ui.notify.error('The list of parent accounts could not be loaded.');
    return;
  }

  const element = ui.form(
    [
      ui.field(
        'Parent account',
        ui.select({
          name: 'userId',
          required: true,
          placeholder: 'Select a parent account',
          options: parents.map((row) => ({ value: String(row.id), label: `${row.fullName} (${row.email})` })),
        }),
      ),
      ui.field(
        'Relationship',
        ui.select({
          name: 'relationship',
          value: 'guardian',
          options: RELATIONSHIPS.map((value) => ({ value, label: ui.label(value) })),
          required: true,
        }),
      ),
      ui.checkbox({ name: 'isPrimaryContact', label: 'Main emergency contact' }),
    ],
    {
      submitLabel: 'Link guardian',
      cancel: ui.closeModal,
      onSubmit: async (values) => {
        await api.post(`/children/${child.id}/guardians`, {
          userId: Number(values.userId),
          relationship: values.relationship,
          isPrimaryContact: Boolean(values.isPrimaryContact),
        });
        ui.notify.ok('Guardian linked.');
        ui.closeModal();
        onSaved();
      },
    },
  );

  ui.openModal({ title: `Link a guardian to ${childDisplay(child)}`, body: element });
}

/** Full child record: wellbeing, guardians, photo and the allowed actions. */
async function openChildSheet({ childId, user, onSaved }) {
  const isAdmin = user.role === 'admin';
  const isStaff = user.role !== 'parent';
  const box = ui.openModal({ title: 'Child record', body: ui.loading('Loading the record…') });
  const body = box.querySelector('.modal-body');

  const draw = async () => {
    const data = await api.get(`/children/${childId}`);
    const child = data.child;
    const guardians = data.guardians || [];

    const links = guardians.length
      ? ui.el(
          'div',
          { class: 'stack' },
          guardians.map((guardian) =>
            ui.el(
              'div',
              { class: 'attendance-row' },
              ui.el(
                'div',
                {},
                ui.el('strong', { text: guardian.fullName || 'Unknown guardian' }),
                ui.el('span', {
                  class: 'muted small',
                  text: [ui.label(guardian.relationship), guardian.email, guardian.phone].filter(Boolean).join(' · '),
                }),
              ),
              ui.el(
                'div',
                { class: 'row' },
                guardian.isPrimaryContact ? ui.badge('Emergency contact', 'info') : null,
                isAdmin
                  ? ui.button('Unlink', {
                      kind: 'danger',
                      onClick: async () => {
                        const confirmed = await ui.confirmAction(
                          `Unlink ${guardian.fullName} from ${childDisplay(child)}?`,
                          { confirmLabel: 'Unlink' },
                        );
                        if (!confirmed) return;
                        try {
                          await api.delete(`/children/${child.id}/guardians/${guardian.id}`);
                          ui.notify.ok('Guardian unlinked.');
                          await draw();
                        } catch (error) {
                          ui.notify.error(error.message);
                        }
                      },
                    })
                  : null,
              ),
            ),
          ),
        )
      : ui.emptyState('No guardians linked yet.', { hint: 'Administrators link parent accounts to a child.' });

    const actions = [
      isAdmin ? ui.button('Edit record', { kind: 'ghost', onClick: () => childDialog({ child, onSaved: () => { onSaved(); draw(); } }) }) : null,
      isStaff ? ui.button('Wellbeing notes', { kind: 'ghost', onClick: () => wellbeingDialog({ child, onSaved: () => { onSaved(); draw(); } }) }) : null,
      isAdmin ? ui.button('Link guardian', { kind: 'ghost', onClick: () => guardianDialog({ child, onSaved: draw }) }) : null,
      isAdmin
        ? ui.button('Delete', {
            kind: 'danger',
            onClick: async () => {
              const confirmed = await ui.confirmAction(`Delete ${childDisplay(child)}? This cannot be undone.`);
              if (!confirmed) return;
              try {
                await api.delete(`/children/${child.id}`);
                await store.loadChildren({ force: true });
                ui.notify.ok('Child removed.');
                ui.closeModal();
                onSaved();
              } catch (error) {
                ui.notify.error(error.message);
              }
            },
          })
        : null,
    ].filter(Boolean);

    ui.mount(
      body,
      ui.el(
        'div',
        { class: 'stack' },
        ui.el(
          'div',
          { class: 'grid grid-2' },
          ui.card({
            title: childDisplay(child),
            subtitle: child.classroomName || 'No classroom assigned',
            body: photoControl({ child, editable: isStaff, onSaved: draw }),
          }),
          ui.card({
            title: 'Enrolment',
            body: ui.definitionList([
              ['Date of birth', child.dateOfBirth ? ui.fmtDate(child.dateOfBirth, { weekday: false }) : ''],
              ['Age', ageLabel(child.dateOfBirth)],
              ['Classroom', child.classroomName],
              ['Status', ui.label(child.enrollmentStatus)],
              ['Start date', child.startDate ? ui.fmtDate(child.startDate, { weekday: false }) : ''],
              ['Guardians', guardians.length],
            ]),
          }),
        ),
        ui.card({
          title: 'Wellbeing',
          subtitle: 'Shared with every educator of this child',
          body: ui.definitionList([
            ['Allergies', child.allergies],
            ['Medical notes', child.medicalNotes],
          ]),
        }),
        ui.card({ title: 'Guardians', body: links }),
        actions.length ? ui.el('div', { class: 'form-actions' }, actions) : null,
      ),
    );
  };

  try {
    await draw();
  } catch (error) {
    ui.mount(body, ui.errorState(error));
  }
}

/** Staff roster: filters, quick stats and a clickable table. */
function rosterView({ rows, filters, onFilter, onOpen, isAdmin, onAdd }) {
  const count = (status) => rows.filter((row) => row.enrollmentStatus === status).length;

  const filtersBox = ui.el(
    'div',
    { class: 'grid grid-3' },
    ui.field(
      'Classroom',
      ui.select({
        name: 'classroomId',
        value: filters.classroomId,
        placeholder: 'All classrooms',
        options: store.classroomOptions({ includeAll: false }),
      }),
    ),
    ui.field(
      'Status',
      ui.select({ name: 'status', value: filters.status, options: FILTER_STATUSES }),
    ),
    ui.field('Search', ui.input({ name: 'q', type: 'search', value: filters.q, placeholder: 'Name' })),
  );
  for (const node of filtersBox.querySelectorAll('select, input')) {
    node.addEventListener('change', () => {
      const values = ui.formValues(filtersBox);
      onFilter({
        classroomId: values.classroomId || '',
        status: values.status || '',
        q: values.q || '',
      });
    });
  }

  const columns = [
    {
      header: 'Child',
      render: (row) =>
        ui.el(
          'div',
          {},
          ui.el('strong', { text: childDisplay(row) }),
          ui.el('span', { class: 'muted small', text: ageLabel(row.dateOfBirth) || 'Age unknown' }),
        ),
    },
    { header: 'Classroom', key: 'classroomName' },
    {
      header: 'Status',
      render: (row) => ui.badge(ui.label(row.enrollmentStatus), STATUS_TONES[row.enrollmentStatus] || 'neutral'),
    },
    { header: 'Guardians', render: (row) => String(row.guardianCount ?? 0) },
    {
      header: 'Wellbeing',
      render: (row) => (row.allergies ? ui.badge('Allergies', 'warn') : ui.el('span', { class: 'muted small', text: '—' })),
    },
    {
      header: '',
      class: 'cell-actions',
      render: (row) => ui.button('Open record', { kind: 'ghost', onClick: () => onOpen(row) }),
    },
  ];

  return ui.el(
    'div',
    { class: 'stack' },
    ui.el(
      'div',
      { class: 'stats' },
      ui.stat(rows.length, 'shown', { tone: 'info' }),
      ui.stat(count('active'), 'active', { tone: 'success' }),
      ui.stat(count('waitlist'), 'waitlisted', { tone: 'warn' }),
      ui.stat(count('archived'), 'archived', { tone: 'neutral' }),
    ),
    ui.card({
      title: 'Filters',
      body: filtersBox,
      actions: isAdmin ? ui.button('Add child', { onClick: onAdd }) : null,
    }),
    ui.card({
      title: 'Roster',
      body: ui.table({ columns, rows, empty: 'No children match these filters.' }),
    }),
  );
}

/** Family view: one card per child, nothing else. */
function familyView({ rows, onOpen }) {
  if (!rows.length) {
    return ui.emptyState('No children are linked to your account yet.', {
      hint: 'Ask the front desk to link your family profile to your child.',
    });
  }
  return ui.el(
    'div',
    { class: 'grid grid-2' },
    rows.map((child) =>
      ui.card({
        title: childDisplay(child),
        subtitle: child.classroomName || 'Classroom pending',
        body: ui.el(
          'div',
          { class: 'stack' },
          child.photoUrl
            ? ui.el('img', { class: 'child-photo', src: child.photoUrl, alt: childDisplay(child) })
            : null,
          ui.definitionList([
            ['Age', ageLabel(child.dateOfBirth)],
            ['Date of birth', child.dateOfBirth ? ui.fmtDate(child.dateOfBirth, { weekday: false }) : ''],
            ['Status', ui.label(child.enrollmentStatus)],
            ['Guardians', child.guardianCount ?? 0],
            ['Allergies', child.allergies],
          ]),
        ),
        actions: ui.button('Open record', { kind: 'ghost', onClick: () => onOpen(child) }),
      }),
    ),
  );
}

export default async function renderChildren(container, ctx) {
  const isAdmin = ctx.user.role === 'admin';
  const isStaff = ctx.user.role !== 'parent';
  const filters = {
    classroomId: isStaff ? ctx.query.classroomId || '' : '',
    status: isStaff ? ctx.query.status ?? 'active' : '',
    q: isStaff ? ctx.query.q || '' : '',
  };

  if (isAdmin) {
    ctx.setActions(ui.button('Add child', { onClick: () => childDialog({ onSaved: () => draw() }) }));
  }

  async function draw() {
    ui.mount(container, ui.loading('Loading the roster…'));
    try {
      const rows = await api.get(
        '/children',
        ui.compact({
          classroomId: filters.classroomId ? Number(filters.classroomId) : undefined,
          status: filters.status || undefined,
          q: filters.q || undefined,
        }),
      );
      const open = (row) => openChildSheet({ childId: row.id, user: ctx.user, onSaved: () => draw() });
      ui.mount(
        container,
        isStaff
          ? rosterView({
              rows,
              filters,
              isAdmin,
              onFilter: (next) => {
                Object.assign(filters, next);
                draw();
              },
              onOpen: open,
              onAdd: () => childDialog({ onSaved: () => draw() }),
            })
          : familyView({ rows, onOpen: open }),
      );
    } catch (error) {
      ui.mount(container, ui.errorState(error));
    }
  }

  await store.loadClassrooms().catch(() => {});
  await store.loadChildren({ force: true });
  await draw();
}
