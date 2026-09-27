'use strict';

/**
 * Staff & families directory (administrators only). Accounts are deactivated
 * instead of deleted so that attendance, reports and invoices keep their author.
 */

import { api } from '../api.js';
import * as ui from '../ui.js';

const ROLES = ['admin', 'teacher', 'parent'];
const ROLE_TONES = { admin: 'info', teacher: 'success', parent: 'neutral' };
const ROLE_FILTERS = [
  { value: '', label: 'All roles' },
  ...ROLES.map((value) => ({ value, label: ui.label(value) })),
];

const roleOptions = () => ROLES.map((value) => ({ value, label: ui.label(value) }));

/** Create a new account. */
function userDialog({ onSaved }) {
  const element = ui.form(
    [
      ui.field('Full name', ui.input({ name: 'fullName', required: true, maxlength: 120 })),
      ui.field('Email', ui.input({ name: 'email', type: 'email', required: true, placeholder: 'name@sproutdesk.test' })),
      ui.field('Role', ui.select({ name: 'role', value: 'teacher', options: roleOptions(), required: true })),
      ui.field('Temporary password', ui.input({ name: 'password', type: 'text', required: true, placeholder: 'At least 8 characters' }), 'The account holder can sign in with it straight away.'),
      ui.field('Phone', ui.input({ name: 'phone', maxlength: 40 })),
      ui.field('Job title', ui.input({ name: 'jobTitle', maxlength: 120, placeholder: 'Room leader' })),
    ],
    {
      submitLabel: 'Create account',
      cancel: ui.closeModal,
      onSubmit: async (values) => {
        await api.post('/users', ui.compact(values));
        ui.notify.ok('Account created.');
        ui.closeModal();
        onSaved();
      },
    },
  );

  ui.openModal({ title: 'New account', body: element });
}


/** Edit an existing account (details, role, status). */
function editDialog({ user, onSaved }) {
  const element = ui.form(
    [
      ui.field('Full name', ui.input({ name: 'fullName', value: user.fullName, required: true, maxlength: 120 })),
      ui.field('Email', ui.input({ name: 'email', type: 'email', value: user.email, required: true })),
      ui.field('Role', ui.select({ name: 'role', value: user.role, options: roleOptions(), required: true })),
      ui.field('Phone', ui.input({ name: 'phone', value: user.phone || '', maxlength: 40 })),
      ui.field('Job title', ui.input({ name: 'jobTitle', value: user.jobTitle || '', maxlength: 120 })),
      ui.checkbox({ name: 'isActive', checked: user.isActive, label: 'Account is active' }),
    ],
    {
      submitLabel: 'Save changes',
      cancel: ui.closeModal,
      onSubmit: async (values) => {
        await api.patch(`/users/${user.id}`, {
          fullName: values.fullName,
          email: values.email,
          role: values.role,
          phone: values.phone,
          jobTitle: values.jobTitle,
          isActive: Boolean(values.isActive),
        });
        ui.notify.ok('Account updated.');
        ui.closeModal();
        onSaved();
      },
    },
  );

  ui.openModal({ title: `Edit ${user.fullName}`, body: element });
}

/** Password reset: signs the account out of every device. */
function passwordDialog({ user, onSaved }) {
  const element = ui.form(
    [
      ui.field('Account', ui.el('strong', { text: `${user.fullName} · ${user.email}` })),
      ui.field('New password', ui.input({ name: 'password', type: 'text', required: true, placeholder: 'At least 8 characters' })),
    ],
    {
      submitLabel: 'Set password',
      cancel: ui.closeModal,
      onSubmit: async (values) => {
        await api.patch(`/users/${user.id}`, { password: values.password });
        ui.notify.ok('Password updated and active sessions ended.');
        ui.closeModal();
        onSaved();
      },
    },
  );

  ui.openModal({ title: 'Reset password', body: element });
}

export default async function renderUsers(container, ctx) {
  const filters = { role: ctx.query.role || '', q: ctx.query.q || '' };

  async function draw() {
    ui.mount(container, ui.loading('Loading accounts…'));
    try {
      const rows = await api.get('/users', ui.compact({ role: filters.role || undefined, q: filters.q || undefined }));
      ctx.setActions(ui.button('New account', { onClick: () => userDialog({ onSaved: () => draw() }) }));

      const count = (predicate) => rows.filter(predicate).length;
      const filtersBox = ui.el(
        'div',
        { class: 'grid grid-2' },
        ui.field('Role', ui.select({ name: 'role', value: filters.role, options: ROLE_FILTERS })),
        ui.field('Search', ui.input({ name: 'q', type: 'search', value: filters.q, placeholder: 'Name or email' })),
      );
      for (const node of filtersBox.querySelectorAll('select, input')) {
        node.addEventListener('change', () => {
          const values = ui.formValues(filtersBox);
          filters.role = values.role || '';
          filters.q = values.q || '';
          draw();
        });
      }

      const columns = [
        {
          header: 'Name',
          render: (row) =>
            ui.el(
              'div',
              {},
              ui.el('strong', { text: row.fullName }),
              row.jobTitle ? ui.el('span', { class: 'muted small', text: row.jobTitle }) : null,
            ),
        },
        { header: 'Role', render: (row) => ui.badge(ui.label(row.role), ROLE_TONES[row.role] || 'neutral') },
        { header: 'Email', render: (row) => row.email },
        { header: 'Phone', render: (row) => row.phone || '—' },
        {
          header: 'Status',
          render: (row) => ui.badge(row.isActive ? 'Active' : 'Inactive', row.isActive ? 'success' : 'danger'),
        },
        { header: 'Last sign-in', render: (row) => (row.lastLoginAt ? ui.fmtRelative(row.lastLoginAt) : 'Never') },
        {
          header: '',
          class: 'cell-actions',
          render: (row) =>
            ui.el(
              'div',
              { class: 'row' },
              ui.button('Edit', { kind: 'ghost', onClick: () => editDialog({ user: row, onSaved: () => draw() }) }),
              ui.button('Password', { kind: 'ghost', onClick: () => passwordDialog({ user: row, onSaved: () => draw() }) }),
              row.isActive
                ? ui.button('Deactivate', {
                    kind: 'danger',
                    onClick: async () => {
                      const confirmed = await ui.confirmAction(
                        `Deactivate ${row.fullName}? They will be signed out and cannot sign in again.`,
                      );
                      if (!confirmed) return;
                      try {
                        await api.delete(`/users/${row.id}`);
                        ui.notify.ok('Account deactivated.');
                        draw();
                      } catch (error) {
                        ui.notify.error(error.message);
                      }
                    },
                  })
                : ui.button('Reactivate', {
                    kind: 'ghost',
                    onClick: async () => {
                      try {
                        await api.patch(`/users/${row.id}`, { isActive: true });
                        ui.notify.ok('Account reactivated.');
                        draw();
                      } catch (error) {
                        ui.notify.error(error.message);
                      }
                    },
                  }),
            ),
        },
      ];

      ui.mount(
        container,
        ui.el(
          'div',
          { class: 'stack' },
          ui.el(
            'div',
            { class: 'stats' },
            ui.stat(rows.length, 'accounts shown', { tone: 'info' }),
            ui.stat(count((row) => row.role === 'admin' && row.isActive), 'administrators'),
            ui.stat(count((row) => row.role === 'teacher' && row.isActive), 'educators', { tone: 'success' }),
            ui.stat(count((row) => row.role === 'parent' && row.isActive), 'families'),
            ui.stat(count((row) => !row.isActive), 'inactive', { tone: 'warn' }),
          ),
          ui.card({ title: 'Filters', body: filtersBox }),
          ui.card({
            title: 'Directory',
            subtitle: 'Accounts are deactivated instead of deleted to keep record history intact',
            body: ui.table({ columns, rows, empty: 'No accounts match these filters.' }),
          }),
        ),
      );
    } catch (error) {
      ui.mount(container, ui.errorState(error));
    }
  }

  await draw();
}

