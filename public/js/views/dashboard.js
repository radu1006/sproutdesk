'use strict';

/** Role-aware dashboard: one request, then cards + panels per role. */

import { api } from '../api.js';
import * as store from '../state.js';
import * as ui from '../ui.js';

const TONES = { children: 'neutral', classrooms: 'neutral', staff: 'info', families: 'info' };
const ATTENDANCE_TONES = {
  present: 'neutral',
  late: 'warn',
  absent: 'bad',
  sick: 'warn',
  holiday: 'info',
  notRecorded: 'warn',
};

function attendanceStats(attendance) {
  if (!attendance) return [];
  const stats = [
    ui.stat(attendance.recorded ?? 0, 'marked today'),
    ui.stat(attendance.present ?? 0, 'present', { tone: 'neutral' }),
    ui.stat(attendance.late ?? 0, 'late', { tone: 'warn' }),
    ui.stat((attendance.absent ?? 0) + (attendance.sick ?? 0), 'absent or sick', { tone: 'bad' }),
    ui.stat(attendance.notRecorded ?? 0, 'still to mark', { tone: 'warn' }),
  ];
  if (attendance.holiday) stats.push(ui.stat(attendance.holiday, 'holiday', { tone: 'info' }));
  return stats;
}

function moneyRow(label, cents, currency) {
  return ui
    .el('div', { class: 'attendance-row' }, ui.el('span', { text: label }), ui.el('strong', { text: ui.fmtMoney(cents, currency) }));
}

function adminPanel(data) {
  const currency = data.currency || store.currency();
  const billing = data.billing || {};
  return ui.el(
    'div',
    { class: 'grid grid-2' },
    ui.card({
      title: 'Attendance today',
      subtitle: ui.fmtDate(data.date),
      body: ui.el('div', { class: 'stats' }, attendanceStats(data.attendance)),
      actions: ui.button('Open register', {
        kind: 'ghost',
        onClick: () => {
          window.location.hash = '#/attendance';
        },
      }),
    }),
    ui.card({
      title: `Billing · ${billing.period || ''}`,
      subtitle: 'Unpaid and partly paid invoices for the current month',
      body: ui.el(
        'div',
        { class: 'stack' },
        moneyRow('Billed', billing.billedCents, currency),
        moneyRow('Collected', billing.paidCents, currency),
        moneyRow('Still open', billing.openCents, currency),
        moneyRow('Overdue', billing.overdueCents, currency),
        ui.el('p', {
          class: 'muted small',
          text: `${billing.openCount || 0} open invoice(s) · ${data.observationsThisMonth || 0} observations logged this month`,
        }),
      ),
    }),
  );
}

function teacherPanel(data) {
  const classrooms = data.classrooms || [];
  return ui.el(
    'div',
    { class: 'grid grid-2' },
    ui.card({
      title: 'Attendance today',
      subtitle: ui.fmtDate(data.date),
      body: ui.el('div', { class: 'stats' }, attendanceStats(data.attendance)),
    }),
    ui.card({
      title: 'My classrooms',
      body: classrooms.length
        ? ui.table({
            columns: [
              { header: 'Classroom', render: (row) => row.name },
              { header: 'Age group', render: (row) => row.ageGroup || '—' },
              { header: 'Children', render: (row) => (row.childCount === undefined ? row.capacity : row.childCount) },
            ],
            rows: classrooms,
            empty: 'You are not leading a classroom yet.',
          })
        : ui.emptyState('You are not leading a classroom yet.'),
    }),
    ui.card({
      title: 'Still to mark today',
      subtitle: `${(data.unmarkedChildren || []).length} child(ren) have no attendance record`,
      class: 'grid-full',
      body: (data.unmarkedChildren || []).length
        ? ui.el(
            'div',
            { class: 'pills' },
            data.unmarkedChildren.map((child) =>
              ui.el('span', { class: 'pill', text: `${child.fullName} · ${child.classroomName || 'unassigned'}` }),
            ),
          )
        : ui.emptyState('Every child in your classes has been marked. Nice work!'),
    }),
  );
}

function parentPanel(data) {
  const currency = data.currency || store.currency();
  const rows = data.children || [];
  return ui.el(
    'div',
    { class: 'stack' },
    ui.card({
      title: 'My children today',
      subtitle: ui.fmtDate(data.date),
      body: rows.length
        ? ui.table({
            columns: [
              { header: 'Child', render: (row) => row.child.fullName },
              { header: 'Classroom', render: (row) => row.child.classroomName || '—' },
              {
                header: 'Attendance',
                render: (row) =>
                  row.attendance
                    ? ui.badge(
                        ui.label(row.attendance.status),
                        row.attendance.status === 'present'
                          ? 'success'
                          : row.attendance.status === 'absent' || row.attendance.status === 'sick'
                            ? 'danger'
                            : 'warn',
                      )
                    : ui.badge('Not marked yet', 'warn'),
              },
              {
                header: 'Daily report',
                render: (row) =>
                  row.hasDailyReport ? ui.badge('Ready', 'success') : ui.badge('Not yet', 'info'),
              },
            ],
            rows,
            empty: 'No children are linked to your account yet.',
          })
        : ui.emptyState('No children are linked to your account yet.'),
    }),
    ui.card({
      title: 'Account balance',
      body: ui.el(
        'div',
        { class: 'stack' },
        moneyRow('Billed', data.billing?.billedCents, currency),
        moneyRow('Paid', data.billing?.paidCents, currency),
        moneyRow('Outstanding', data.billing?.balanceCents, currency),
        ui.el('p', { class: 'muted small', text: `${data.billing?.openCount || 0} open invoice(s)` }),
      ),
    }),
  );
}

/* ------------------------------------------------------------- shared panels */

function announcementsPanel(announcements) {
  return ui.card({
    title: 'Noticeboard',
    subtitle: 'Latest announcements for you',
    actions: ui.button('All announcements', {
      kind: 'ghost',
      onClick: () => {
        window.location.hash = '#/announcements';
      },
    }),
    body: announcements.length
      ? ui.el(
          'div',
          { class: 'stack' },
          announcements.map((item) =>
            ui.el(
              'div',
              { class: 'comment' },
              ui.el('strong', { text: item.title }),
              ui.el('span', {
                class: 'muted small',
                text: ` · ${ui.fmtDate(item.publishedAt, { weekday: false })}${
                  item.classroomName ? ` · ${item.classroomName}` : ''
                }`,
              }),
              ui.el('p', { class: 'post-body', text: item.body }),
            ),
          ),
        )
      : ui.emptyState('No announcements right now.'),
  });
}

function eventsPanel(events) {
  return ui.card({
    title: 'Coming up',
    actions: ui.button('Calendar', {
      kind: 'ghost',
      onClick: () => {
        window.location.hash = '#/events';
      },
    }),
    body: events.length
      ? ui.el(
          'div',
          { class: 'event-list' },
          events.map((event) => {
            const start = new Date(event.startsAt);
            return ui.el(
              'div',
              { class: 'event-item' },
              ui.el(
                'div',
                { class: 'event-date' },
                ui.el('span', { text: String(start.getUTCDate()) }),
                ui.el('small', {
                  text: start.toLocaleString(undefined, { month: 'short', timeZone: 'UTC' }),
                }),
              ),
              ui.el(
                'div',
                {},
                ui.el('strong', { text: event.title }),
                ui.el('p', {
                  class: 'muted small',
                  text: `${event.allDay ? 'All day' : ui.fmtDateTime(event.startsAt)}${
                    event.location ? ` · ${event.location}` : ''
                  }`,
                }),
              ),
            );
          }),
        )
      : ui.emptyState('Nothing scheduled yet.'),
  });
}

function feedPanel(posts) {
  return ui.card({
    title: 'Class feed',
    subtitle: 'Photos and notes from the rooms',
    actions: ui.button('Open feed', {
      kind: 'ghost',
      onClick: () => {
        window.location.hash = '#/feed';
      },
    }),
    body: posts.length
      ? ui.el(
          'div',
          { class: 'feed' },
          posts.map((post) =>
            ui.el(
              'article',
              { class: 'post' },
              post.mediaType === 'image' && post.mediaUrl
                ? ui.el('img', { class: 'post-media', src: post.mediaUrl, alt: post.title || 'Class photo' })
                : null,
              ui.el('strong', { text: post.title || post.classroomName || 'Update' }),
              ui.el('p', {
                class: 'post-meta',
                text: `${post.authorName || 'Staff'} · ${ui.fmtRelative(post.postedAt)}`,
              }),
              ui.el('p', { class: 'post-body', text: post.body || '' }),
            ),
          ),
        )
      : ui.emptyState('No posts yet.'),
  });
}

/* --------------------------------------------------------------------- view */

export default async function renderDashboard(container, ctx) {
  const data = await api.get('/dashboard');
  store.setUnread(data.unread || {});

  let rolePanel;
  if (data.role === 'admin') rolePanel = adminPanel(data);
  else if (data.role === 'teacher') rolePanel = teacherPanel(data);
  else rolePanel = parentPanel(data);

  ui.mount(
    container,
    ui.el(
      'div',
      { class: 'stats' },
      (data.cards || []).map((card) =>
        ui.stat(card.value, card.label, { tone: TONES[card.key] || 'neutral' }),
      ),
    ),
    rolePanel,
    ui.el(
      'div',
      { class: 'grid grid-2' },
      announcementsPanel(data.announcements || []),
      eventsPanel(data.upcomingEvents || []),
    ),
    feedPanel(data.feed || []),
  );

  ctx.setActions(
    ui.button('Reload', {
      kind: 'ghost',
      onClick: () => ctx.go('/dashboard'),
    }),
  );
}
