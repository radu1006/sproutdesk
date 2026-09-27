'use strict';

/**
 * Aggregated "today" view. A single request returns every number the dashboard
 * cards need, tailored to the role of the signed-in user:
 *
 *   admin   -> whole-centre counts, billing for the current month
 *   teacher -> their classrooms, who is still unmarked today
 *   parent  -> their children, today's attendance/report and what is owed
 */

const express = require('express');
const db = require('../db');
const centre = require('../lib/centre');
const serialize = require('../lib/serialize');
const { asyncHandler } = require('../lib/http');
const { todayIso, addDays, periodLabel } = require('../lib/dates');
const access = require('../lib/access');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

/** Limiting rows by classroom, when the user is not an admin. */
async function classroomColumnScope(user, column) {
  const ids = await access.visibleClassroomIds(user);
  if (ids === null) return { sql: '', params: [] };
  if (ids.length === 0) return { sql: `${column} IS NULL`, params: [] };
  const placeholders = ids.map(() => '?').join(', ');
  return {
    sql: `(${column} IS NULL OR ${column} IN (${placeholders}))`,
    params: ids,
  };
}

/** Announcing/news rows are addressed to a role as well as a classroom. */
function audienceClause(alias, role) {
  if (role === 'parent') return `${alias}.audience IN ('all', 'parents')`;
  if (role === 'teacher') return `${alias}.audience IN ('all', 'teachers')`;
  return null;
}

async function attendanceSummary(childIds, date) {
  const empty = { present: 0, absent: 0, late: 0, sick: 0, holiday: 0 };
  if (Array.isArray(childIds) && childIds.length === 0) return { ...empty, recorded: 0 };

  const conditions = ['a.attendance_date = ?'];
  const params = [date];
  if (Array.isArray(childIds)) {
    conditions.push(`a.child_id IN (${childIds.map(() => '?').join(', ')})`);
    params.push(...childIds);
  }

  const rows = await db.all(
    `SELECT a.status, COUNT(*) AS total FROM attendance a
      WHERE ${conditions.join(' AND ')} GROUP BY a.status`,
    params,
  );
  const counts = { ...empty };
  let recorded = 0;
  for (const row of rows) {
    counts[row.status] = Number(row.total);
    recorded += Number(row.total);
  }
  return { ...counts, recorded };
}

async function announcementRows(user, { limit = 5, onlyUnread = false } = {}) {
  const conditions = ['(a.expires_on IS NULL OR a.expires_on >= ?)'];
  const params = [user.id, todayIso()]; // the JOIN parameter always comes first

  const scope = await classroomColumnScope(user, 'a.classroom_id');
  if (scope.sql) {
    conditions.push(scope.sql);
    params.push(...scope.params);
  }
  const audience = audienceClause('a', user.role);
  if (audience) conditions.push(audience);
  if (onlyUnread) conditions.push('r.read_at IS NULL');

  return db.all(
    `SELECT a.*, cl.name AS classroom_name, u.full_name AS author_name, r.read_at AS is_read
       FROM announcements a
       LEFT JOIN classrooms cl ON cl.id = a.classroom_id
       LEFT JOIN users u ON u.id = a.author_id
       LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = ?
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.published_at DESC
      LIMIT ?`,
    [...params, limit],
  );
}

async function recentPosts(user, limit = 5) {
  const ids = await access.visibleClassroomIds(user);
  if (Array.isArray(ids) && ids.length === 0) return [];

  const params = [];
  let where = '';
  if (Array.isArray(ids)) {
    where = `WHERE p.classroom_id IN (${ids.map(() => '?').join(', ')})`;
    params.push(...ids);
  }

  const rows = await db.all(
    `SELECT p.*, cl.name AS classroom_name, u.full_name AS author_name
       FROM class_posts p
       LEFT JOIN classrooms cl ON cl.id = p.classroom_id
       LEFT JOIN users u ON u.id = p.author_id
       ${where}
      ORDER BY p.posted_at DESC
      LIMIT ?`,
    [...params, limit],
  );
  return rows.map(serialize.post);
}

async function unreadCounts(user) {
  const messages = await db.get(
    'SELECT COUNT(*) AS total FROM messages WHERE recipient_id = ? AND read_at IS NULL',
    [user.id],
  );
  // Capped at 200 so a badge never triggers an unbounded scan.
  const announcements = await announcementRows(user, { limit: 200, onlyUnread: true });
  return { messages: Number(messages.total), announcements: announcements.length };
}

async function upcomingEvents(user, limit = 5) {
  const conditions = ['e.starts_at >= ?'];
  const params = [`${todayIso()}T00:00:00.000Z`];

  const scope = await classroomColumnScope(user, 'e.classroom_id');
  if (scope.sql) {
    conditions.push(scope.sql);
    params.push(...scope.params);
  }
  const audience = audienceClause('e', user.role);
  if (audience) conditions.push(audience);

  const rows = await db.all(
    `SELECT e.* FROM events e WHERE ${conditions.join(' AND ')} ORDER BY e.starts_at LIMIT ?`,
    [...params, limit],
  );
  return rows.map(serialize.event);
}

/** Children visible to the user (used by every role card). */
async function visibleChildren(user) {
  const ids = await access.accessibleChildIds(user);
  const params = [];
  let where = "WHERE ch.enrollment_status = 'active'";
  if (Array.isArray(ids)) {
    if (ids.length === 0) return [];
    where += ` AND ch.id IN (${ids.map(() => '?').join(', ')})`;
    params.push(...ids);
  }
  return db.all(
    `SELECT ch.*, cl.name AS classroom_name
       FROM children ch
       LEFT JOIN classrooms cl ON cl.id = ch.classroom_id
       ${where}
      ORDER BY ch.first_name, ch.last_name`,
    params,
  );
}

async function todayAttendanceRows(childIds, date) {
  if (Array.isArray(childIds) && childIds.length === 0) return [];
  const conditions = ['attendance_date = ?'];
  const params = [date];
  if (Array.isArray(childIds)) {
    conditions.push(`child_id IN (${childIds.map(() => '?').join(', ')})`);
    params.push(...childIds);
  }
  return db.all(
    `SELECT * FROM attendance WHERE ${conditions.join(' AND ')} ORDER BY child_id`,
    params,
  );
}

async function buildAdmin(date) {
  const children = await db.get(
    "SELECT COUNT(*) AS total FROM children WHERE enrollment_status = 'active'",
  );
  const classrooms = await db.get('SELECT COUNT(*) AS total FROM classrooms');
  const staff = await db.get(
    "SELECT COUNT(*) AS total FROM users WHERE role = 'teacher' AND is_active = 1",
  );
  const families = await db.get(
    "SELECT COUNT(*) AS total FROM users WHERE role = 'parent' AND is_active = 1",
  );
  const attendance = await attendanceSummary(null, date);

  const period = periodLabel(date);
  const billing = await db.get(
    `SELECT COUNT(*) AS open_count,
            COALESCE(SUM(i.amount_cents), 0) AS billed_cents,
            COALESCE(SUM((SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p
                           WHERE p.invoice_id = i.id)), 0) AS paid_cents,
            COALESCE(SUM(CASE WHEN i.due_date < ? THEN i.amount_cents ELSE 0 END), 0)
              AS overdue_cents
       FROM invoices i
      WHERE i.period_label = ? AND i.status IN ('unpaid', 'partial')`,
    [date, period],
  );
  const observations = await db.get(
    'SELECT COUNT(*) AS total FROM observations WHERE observed_on >= ?',
    [`${period}-01`],
  );

  return {
    cards: [
      { key: 'children', label: 'Active children', value: Number(children.total) },
      { key: 'classrooms', label: 'Classrooms', value: Number(classrooms.total) },
      { key: 'staff', label: 'Teachers', value: Number(staff.total) },
      { key: 'families', label: 'Family accounts', value: Number(families.total) },
    ],
    attendance: {
      date,
      expected: Number(children.total),
      notRecorded: Math.max(0, Number(children.total) - attendance.recorded),
      ...attendance,
    },
    billing: {
      period,
      openCount: Number(billing.open_count),
      billedCents: Number(billing.billed_cents),
      paidCents: Number(billing.paid_cents),
      openCents: Number(billing.billed_cents) - Number(billing.paid_cents),
      overdueCents: Number(billing.overdue_cents),
    },
    observationsThisMonth: Number(observations.total),
  };
}

async function buildTeacher(user, date) {
  const classroomIds = await access.teacherClassroomIds(user);
  const classrooms = classroomIds.length
    ? await db.all(
        `SELECT cl.*, u.full_name AS lead_teacher_name,
                (SELECT COUNT(*) FROM children ch
                  WHERE ch.classroom_id = cl.id AND ch.enrollment_status = 'active') AS child_count
           FROM classrooms cl
           LEFT JOIN users u ON u.id = cl.lead_teacher_id
          WHERE cl.id IN (${classroomIds.map(() => '?').join(', ')})
          ORDER BY cl.name`,
        classroomIds,
      )
    : [];

  const childIds = await access.accessibleChildIds(user);
  const rows = await todayAttendanceRows(childIds, date);
  const marked = new Set(rows.map((row) => Number(row.child_id)));
  const children = await visibleChildren(user);
  const unmarked = children.filter((child) => !marked.has(Number(child.id)));

  const counts = { present: 0, absent: 0, late: 0, sick: 0, holiday: 0 };
  for (const row of rows) counts[row.status] += 1;

  const month = `${periodLabel(date)}-01`;
  const observations =
    Array.isArray(childIds) && childIds.length === 0
      ? { total: 0 }
      : await db.get(
          `SELECT COUNT(*) AS total FROM observations WHERE observed_on >= ?${
            Array.isArray(childIds) ? ` AND child_id IN (${childIds.map(() => '?').join(', ')})` : ''
          }`,
          Array.isArray(childIds) ? [month, ...childIds] : [month],
        );

  return {
    cards: [
      { key: 'children', label: 'Children in my classes', value: children.length },
      { key: 'classrooms', label: 'My classrooms', value: classroomIds.length },
      { key: 'recorded', label: 'Marked today', value: rows.length },
      { key: 'unmarked', label: 'Still to mark', value: unmarked.length },
    ],
    classrooms: classrooms.map(serialize.classroom),
    attendance: {
      date,
      expected: children.length,
      recorded: rows.length,
      notRecorded: unmarked.length,
      ...counts,
    },
    unmarkedChildren: unmarked.slice(0, 25).map(serialize.child),
    observationsThisMonth: Number(observations.total),
  };
}

async function buildParent(user, date) {
  const children = await visibleChildren(user);
  const ids = children.map((child) => Number(child.id));
  const rows = await todayAttendanceRows(ids, date);
  const byChild = new Map(rows.map((row) => [Number(row.child_id), row]));

  const reports = ids.length
    ? await db.all(
        `SELECT child_id FROM daily_reports
          WHERE report_date = ? AND child_id IN (${ids.map(() => '?').join(', ')})`,
        [date, ...ids],
      )
    : [];
  const reported = new Set(reports.map((row) => Number(row.child_id)));

  const billing = ids.length
    ? await db.get(
        `SELECT COUNT(*) AS open_count,
                COALESCE(SUM(i.amount_cents), 0) AS billed_cents,
                COALESCE(SUM((SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p
                               WHERE p.invoice_id = i.id)), 0) AS paid_cents
           FROM invoices i
          WHERE i.child_id IN (${ids.map(() => '?').join(', ')})
            AND i.status IN ('unpaid', 'partial')`,
        ids,
      )
    : { open_count: 0, billed_cents: 0, paid_cents: 0 };

  return {
    cards: [
      { key: 'children', label: 'My children', value: children.length },
      {
        key: 'present',
        label: 'In today',
        value: rows.filter((row) => row.status === 'present' || row.status === 'late').length,
      },
      { key: 'reports', label: 'Daily reports today', value: reported.size },
      { key: 'invoices', label: 'Open invoices', value: Number(billing.open_count) },
    ],
    children: children.map((child) => ({
      child: serialize.child(child),
      attendance: serialize.attendance(byChild.get(Number(child.id)) || null),
      hasDailyReport: reported.has(Number(child.id)),
    })),
    attendance: {
      date,
      expected: children.length,
      recorded: rows.length,
      notRecorded: Math.max(0, children.length - rows.length),
    },
    billing: {
      openCount: Number(billing.open_count),
      billedCents: Number(billing.billed_cents),
      paidCents: Number(billing.paid_cents),
      balanceCents: Number(billing.billed_cents) - Number(billing.paid_cents),
    },
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const date = todayIso();
    const [announcements, events, feed, unread, currency] = await Promise.all([
      announcementRows(req.user, { limit: 5 }),
      upcomingEvents(req.user, 5),
      recentPosts(req.user, 5),
      unreadCounts(req.user),
      // The currency saved in Settings, not the environment default.
      centre.currency(),
    ]);

    let payload;
    if (req.user.role === 'admin') payload = await buildAdmin(date);
    else if (req.user.role === 'teacher') payload = await buildTeacher(req.user, date);
    else payload = await buildParent(req.user, date);

    res.json({
      data: {
        role: req.user.role,
        date,
        weekEnding: addDays(date, 7),
        currency,
        announcements: announcements.map(serialize.announcement),
        upcomingEvents: events,
        feed,
        unread,
        ...payload,
      },
    });
  }),
);

module.exports = router;
