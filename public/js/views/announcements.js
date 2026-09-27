'use strict';

/**
 * Announcements: centre-wide or classroom notices with per-user read tracking.
 * Educators publish to their own classroom, administrators to the whole centre.
 */

import { api } from '../api.js';
import * as store from '../state.js';
import * as ui from '../ui.js';

const AUDIENCES = ['all', 'teachers', 'parents'];
const audienceOptions = () => AUDIENCES.map((value) => ({ value, label: ui.label(value) }));

/** Create or edit an announcement. */
function announcementDialog({ announcement, user, onSaved }) {
  const editing = Boolean(announcement);
  const isTeacher = user.role === 'teacher';

  const element = ui.form(
    [
      ui.field('Title', ui.input({ name: 'title', value: announcement?.title || '', required: true, maxlength: 160 })),
      ui.field('Message', ui.textarea({ name: 'body', value: announcement?.body || '', rows: 6, required: true })),
      ui.field(
        'Audience',
        ui.select({ name: 'audience', value: announcement?.audience || 'all', options: audienceOptions(), required: true }),
      ),
      ui.field(
        'Classroom',
        ui.select({
          name: 'classroomId',
          value: announcement?.classroomId ?? '',
          placeholder: isTeacher ? 'Select a classroom' : 'Whole centre',
          options: store.classroomOptions(),
          required: isTeacher,
        }),
        isTeacher ? 'Educators publish to one of their classrooms.' : 'Leave empty to reach the whole centre.',
      ),
      ui.field('Expires on', ui.input({ name: 'expiresOn', type: 'date', value: announcement?.expiresOn || '' }), 'Optional: the notice disappears after this date.'),
    ],
    {
      submitLabel: editing ? 'Save changes' : 'Publish',
      cancel: ui.closeModal,
      onSubmit: async (values) => {
        const payload = ui.compact({
          title: values.title,
          body: values.body,
          audience: values.audience,
          classroomId: values.classroomId ? Number(values.classroomId) : undefined,
          expiresOn: values.expiresOn || undefined,
        });
        if (editing) {
          await api.patch(`/announcements/${announcement.id}`, {
            ...payload,
            classroomId: values.classroomId ? Number(values.classroomId) : null,
          });
        } else {
          await api.post('/announcements', payload);
        }
        ui.notify.ok(editing ? 'Announcement updated.' : 'Announcement published.');
        ui.closeModal();
        onSaved();
      },
    },
  );

  ui.openModal({ title: editing ? 'Edit announcement' : 'New announcement', body: element });
}

/** Read receipts for one announcement (staff only). */
async function receiptsDialog({ announcement }) {
  const box = ui.openModal({
    title: `Read receipts · ${announcement.title}`,
    body: ui.loading('Loading the receipts…'),
  });
  const body = box.querySelector('.modal-body');

  try {
    const [detail, reads] = await Promise.all([
      api.get(`/announcements/${announcement.id}`),
      api.get(`/announcements/${announcement.id}/reads`),
    ]);
    const readCount = Number(detail.readCount ?? 0);
    const userCount = Number(detail.userCount ?? 0);
    ui.mount(
      body,
      ui.el(
        'div',
        { class: 'stack' },
        ui.el(
          'div',
          { class: 'stats' },
          ui.stat(readCount, 'have read', { tone: 'success' }),
          ui.stat(Math.max(0, userCount - readCount), 'not read yet', { tone: 'warn' }),
          ui.stat(userCount, 'active accounts'),
        ),
        ui.table({
          columns: [
            { header: 'Name', render: (row) => row.fullName },
            { header: 'Role', render: (row) => ui.badge(ui.label(row.role), 'info') },
            { header: 'Read at', render: (row) => ui.fmtDateTime(row.readAt) },
          ],
          rows: reads,
          empty: 'Nobody has opened this announcement yet.',
        }),
      ),
    );
  } catch (error) {
    ui.mount(body, ui.errorState(error));
  }
}

/** One notice, rendered as a card with its action row. */
function announcementCard({ announcement, user, onChanged }) {
  const canManage = user.role === 'admin' || Number(announcement.authorId) === Number(user.id);
  const isNew = announcement.isRead === false;

  const markRead = async () => {
    try {
      await api.post(`/announcements/${announcement.id}/read`);
      onChanged({ silent: true });
    } catch (error) {
      ui.notify.error(error.message);
    }
  };

  return ui.card({
    title: announcement.title,
    actions: [
      isNew ? ui.badge('New', 'info') : null,
      ui.badge(ui.label(announcement.audience), 'neutral'),
      announcement.classroomName ? ui.badge(announcement.classroomName, 'success') : null,
      announcement.expiresOn ? ui.badge(`until ${announcement.expiresOn}`, 'warn') : null,
    ].filter(Boolean),
    subtitle: [
      announcement.authorName || 'SproutDesk',
      ui.fmtDateTime(announcement.publishedAt),
      announcement.classroomName || 'Whole centre',
    ].join(' · '),
    body: ui.el(
      'div',
      { class: 'stack' },
      ui.el('p', { class: 'prose', text: announcement.body }),
      ui.el(
        'div',
        { class: 'row' },
        isNew ? ui.button('Mark as read', { onClick: markRead }) : ui.el('span', { class: 'muted small', text: 'Read' }),
        canManage
          ? ui.button('Edit', {
              kind: 'ghost',
              onClick: () => announcementDialog({ announcement, user, onSaved: () => onChanged() }),
            })
          : null,
        canManage
          ? ui.button('Receipts', { kind: 'ghost', onClick: () => receiptsDialog({ announcement }) })
          : null,
        canManage
          ? ui.button('Delete', {
              kind: 'danger',
              onClick: async () => {
                const confirmed = await ui.confirmAction('Delete this announcement? Read receipts are removed too.');
                if (!confirmed) return;
                try {
                  await api.delete(`/announcements/${announcement.id}`);
                  ui.notify.ok('Announcement deleted.');
                  onChanged();
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

export default async function renderAnnouncements(container, ctx) {
  const user = ctx.user;
  const isStaff = user.role !== 'parent';
  const filters = {
    classroomId: ctx.query.classroomId || '',
    unreadOnly: ctx.query.unreadOnly === '1' || ctx.query.unreadOnly === 'true',
    active: ctx.query.active !== '0' && ctx.query.active !== 'false',
  };

  if (isStaff) await store.loadClassrooms().catch(() => {});

  const pushQuery = () =>
    ctx.go(
      '/announcements',
      ui.compact({
        classroomId: filters.classroomId || undefined,
        unreadOnly: filters.unreadOnly ? '1' : undefined,
        active: filters.active ? undefined : '0',
      }),
    );

  async function draw({ silent = false } = {}) {
    if (!silent) ui.mount(container, ui.loading('Loading announcements…'));
    try {
      const rows = await api.get(
        '/announcements',
        ui.compact({
          classroomId: filters.classroomId ? Number(filters.classroomId) : undefined,
          unreadOnly: filters.unreadOnly ? 1 : undefined,
          active: filters.active ? undefined : 0,
          limit: 60,
        }),
      );

      const unread = rows.filter((row) => row.isRead === false).length;
      const expiring = rows.filter((row) => row.expiresOn).length;

      ctx.setActions(
        isStaff
          ? [
              ui.button('New announcement', {
                onClick: () => announcementDialog({ user, onSaved: () => draw() }),
              }),
            ]
          : null,
      );

      const filterBox = ui.el(
        'div',
        { class: 'stack' },
        ui.el(
          'div',
          { class: 'grid grid-2' },
          isStaff
            ? ui.field(
                'Classroom',
                ui.select({
                  name: 'classroomId',
                  value: filters.classroomId,
                  options: store.classroomOptions({ includeAll: true }),
                }),
              )
            : null,
          ui.checkbox({ name: 'unreadOnly', checked: filters.unreadOnly, label: 'Only unread notices' }),
          ui.checkbox({ name: 'active', checked: filters.active, label: 'Hide expired notices' }),
        ),
      );
      filterBox.querySelector('select')?.addEventListener('change', (event) => {
        filters.classroomId = event.target.value || '';
        pushQuery();
      });
      filterBox.querySelector('[name="unreadOnly"]').addEventListener('change', (event) => {
        filters.unreadOnly = event.target.checked;
        pushQuery();
      });
      filterBox.querySelector('[name="active"]').addEventListener('change', (event) => {
        filters.active = event.target.checked;
        pushQuery();
      });

      ui.mount(
        container,
        ui.el(
          'div',
          { class: 'stack' },
          ui.el(
            'div',
            { class: 'stats' },
            ui.stat(rows.length, 'notices shown', { tone: 'info' }),
            ui.stat(unread, 'unread', { tone: unread ? 'warn' : 'success' }),
            ui.stat(expiring, 'with an expiry date'),
          ),
          ui.card({ title: 'Show', body: filterBox }),
          rows.length
            ? ui.el(
                'div',
                { class: 'stack' },
                rows.map((announcement) =>
                  announcementCard({
                    announcement,
                    user,
                    onChanged: (options) => draw(options || {}),
                  }),
                ),
              )
            : ui.emptyState('No announcements match these filters.', {
                hint: filters.unreadOnly ? 'You have read everything — try clearing the filter.' : undefined,
              }),
        ),
      );
    } catch (error) {
      ui.mount(container, ui.errorState(error));
    }
  }

  await draw();
}

