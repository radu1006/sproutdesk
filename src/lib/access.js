'use strict';

/**
 * Role based visibility rules.
 *
 *   admin   -> the whole centre
 *   teacher -> the classrooms they lead (roster, attendance, reports, feed)
 *   parent  -> only the children linked to them through `guardians`
 *
 * `null` returned from a "...Ids" helper means "no restriction at all".
 */

const db = require('../db');
const { forbidden, notFound } = require('./errors');

const isAdmin = (user) => user.role === 'admin';

async function teacherClassroomIds(user) {
  if (user.role !== 'teacher') return [];
  const rows = await db.all('SELECT id FROM classrooms WHERE lead_teacher_id = ?', [user.id]);
  return rows.map((row) => Number(row.id));
}

async function guardianChildIds(user) {
  const rows = await db.all('SELECT child_id FROM guardians WHERE user_id = ?', [user.id]);
  return rows.map((row) => Number(row.child_id));
}

/** null = all children, array = the ids this user may see. */
async function accessibleChildIds(user) {
  if (isAdmin(user)) return null;
  if (user.role === 'parent') return guardianChildIds(user);
  const classroomIds = await teacherClassroomIds(user);
  if (classroomIds.length === 0) return [];
  const placeholders = classroomIds.map(() => '?').join(', ');
  const rows = await db.all(
    `SELECT id FROM children WHERE classroom_id IN (${placeholders})`,
    classroomIds,
  );
  return rows.map((row) => Number(row.id));
}

/** null = all classrooms, array = the ids this user may see. */
async function visibleClassroomIds(user) {
  if (isAdmin(user)) return null;
  if (user.role === 'teacher') return teacherClassroomIds(user);
  const childIds = await guardianChildIds(user);
  if (childIds.length === 0) return [];
  const placeholders = childIds.map(() => '?').join(', ');
  const rows = await db.all(
    `SELECT DISTINCT classroom_id AS id FROM children
      WHERE classroom_id IS NOT NULL AND id IN (${placeholders})`,
    childIds,
  );
  return rows.map((row) => Number(row.id));
}

/** Loads a child and refuses the request unless the user may see/change it. */
async function assertChildAccess(user, childId, { write = false } = {}) {
  const child = await db.get('SELECT * FROM children WHERE id = ?', [childId]);
  if (!child) throw notFound('That child record does not exist.');

  if (isAdmin(user)) return child;

  if (user.role === 'parent') {
    if (write) throw forbidden('Parents have read-only access to child records.');
    const ids = await guardianChildIds(user);
    if (!ids.includes(Number(child.id))) {
      throw forbidden('That child is not linked to your account.');
    }
    return child;
  }

  const classroomIds = await teacherClassroomIds(user);
  if (!classroomIds.includes(Number(child.classroom_id))) {
    throw forbidden('That child is not in one of your classrooms.');
  }
  return child;
}

async function assertClassroomAccess(user, classroomId, { write = false } = {}) {
  const classroom = await db.get('SELECT * FROM classrooms WHERE id = ?', [classroomId]);
  if (!classroom) throw notFound('That classroom does not exist.');
  if (isAdmin(user)) return classroom;

  if (user.role === 'teacher') {
    const ids = await teacherClassroomIds(user);
    if (!ids.includes(Number(classroom.id))) {
      throw forbidden('You are not assigned to that classroom.');
    }
    return classroom;
  }

  if (write) throw forbidden('Parents cannot modify classroom data.');
  const ids = await visibleClassroomIds(user);
  if (!ids.includes(Number(classroom.id))) {
    throw forbidden('You do not have access to that classroom.');
  }
  return classroom;
}

/**
 * Users a given user is allowed to exchange messages with:
 *   admin   -> everyone
 *   teacher -> the parents of the children in their classrooms + all admins
 *   parent  -> the teachers of their children's classrooms + all admins
 */
async function messageContacts(user) {
  if (isAdmin(user)) {
    return db.all(
      `SELECT id, full_name, role, email FROM users
        WHERE is_active = 1 AND id <> ? ORDER BY role, full_name`,
      [user.id],
    );
  }

  if (user.role === 'teacher') {
    const classroomIds = await teacherClassroomIds(user);
    if (classroomIds.length === 0) {
      return db.all(
        `SELECT id, full_name, role, email FROM users
          WHERE is_active = 1 AND role = 'admin' AND id <> ? ORDER BY full_name`,
        [user.id],
      );
    }
    const placeholders = classroomIds.map(() => '?').join(', ');
    return db.all(
      `SELECT DISTINCT u.id, u.full_name, u.role, u.email
         FROM users u
         JOIN guardians g ON g.user_id = u.id
         JOIN children c ON c.id = g.child_id
        WHERE c.classroom_id IN (${placeholders}) AND u.is_active = 1 AND u.id <> ?`,
      [...classroomIds, user.id],
    );
  }

  const childIds = await guardianChildIds(user);
  if (childIds.length === 0) {
    return db.all(
      `SELECT id, full_name, role, email FROM users
        WHERE is_active = 1 AND role = 'admin' AND id <> ? ORDER BY full_name`,
      [user.id],
    );
  }
  const placeholders = childIds.map(() => '?').join(', ');
  return db.all(
    `SELECT DISTINCT u.id, u.full_name, u.role, u.email
       FROM users u
       JOIN classrooms cl ON cl.lead_teacher_id = u.id
       JOIN children c ON c.classroom_id = cl.id
      WHERE c.id IN (${placeholders}) AND u.is_active = 1 AND u.id <> ?`,
    [...childIds, user.id],
  );
}

async function canMessage(user, otherUserId) {
  if (isAdmin(user)) return true;
  const contacts = await messageContacts(user);
  return contacts.some((contact) => Number(contact.id) === Number(otherUserId));
}

module.exports = {
  isAdmin,
  teacherClassroomIds,
  guardianChildIds,
  accessibleChildIds,
  visibleClassroomIds,
  assertChildAccess,
  assertClassroomAccess,
  messageContacts,
  canMessage,
};
