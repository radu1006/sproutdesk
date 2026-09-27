'use strict';

/**
 * Row -> API shape mappers. Every route returns camelCase JSON built through
 * these helpers, which keeps the database column names out of the public API
 * and makes the frontend code uniform.
 */

const bool = (value) => value === 1 || value === true || value === '1';
const num = (value) => (value === null || value === undefined ? null : Number(value));

function user(row) {
  if (!row) return null;
  return {
    id: num(row.id),
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    phone: row.phone ?? null,
    jobTitle: row.job_title ?? null,
    isActive: bool(row.is_active),
    lastLoginAt: row.last_login_at ?? null,
    createdAt: row.created_at ?? null,
  };
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: num(row.id),
    fullName: row.full_name,
    role: row.role,
    email: row.email ?? null,
  };
}

function classroom(row) {
  if (!row) return null;
  return {
    id: num(row.id),
    name: row.name,
    ageGroup: row.age_group ?? null,
    capacity: num(row.capacity),
    roomLabel: row.room_label ?? null,
    leadTeacherId: num(row.lead_teacher_id),
    leadTeacherName: row.lead_teacher_name ?? null,
    notes: row.notes ?? null,
    childCount: row.child_count === undefined ? undefined : num(row.child_count),
  };
}

function child(row) {
  if (!row) return null;
  return {
    id: num(row.id),
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: `${row.first_name} ${row.last_name}`,
    dateOfBirth: row.date_of_birth,
    classroomId: num(row.classroom_id),
    classroomName: row.classroom_name ?? null,
    enrollmentStatus: row.enrollment_status,
    startDate: row.start_date ?? null,
    allergies: row.allergies ?? null,
    medicalNotes: row.medical_notes ?? null,
    photoUrl: row.photo_url ?? null,
    guardianCount: row.guardian_count === undefined ? undefined : num(row.guardian_count),
  };
}

function guardian(row) {
  if (!row) return null;
  return {
    id: num(row.id),
    childId: num(row.child_id),
    userId: num(row.user_id),
    relationship: row.relationship,
    isPrimaryContact: bool(row.is_primary_contact),
    fullName: row.full_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
  };
}

function attendance(row) {
  if (!row) return null;
  return {
    id: num(row.id),
    childId: num(row.child_id),
    childName: row.first_name ? `${row.first_name} ${row.last_name}` : null,
    date: row.attendance_date,
    status: row.status,
    checkInTime: row.check_in_time ?? null,
    checkOutTime: row.check_out_time ?? null,
    note: row.note ?? null,
    recordedBy: num(row.recorded_by),
  };
}

function dailyReport(row) {
  if (!row) return null;
  return {
    id: num(row.id),
    childId: num(row.child_id),
    childName: row.first_name ? `${row.first_name} ${row.last_name}` : null,
    date: row.report_date,
    mood: row.mood ?? null,
    breakfast: row.breakfast ?? null,
    lunch: row.lunch ?? null,
    snack: row.snack ?? null,
    napMinutes: num(row.nap_minutes),
    toiletNotes: row.toilet_notes ?? null,
    activities: row.activities ?? null,
    teacherNote: row.teacher_note ?? null,
    createdBy: num(row.created_by),
    updatedAt: row.updated_at ?? null,
  };
}

function observation(row) {
  if (!row) return null;
  return {
    id: num(row.id),
    childId: num(row.child_id),
    childName: row.first_name ? `${row.first_name} ${row.last_name}` : null,
    area: row.area,
    level: row.level,
    note: row.note ?? null,
    observedOn: row.observed_on,
    createdBy: num(row.created_by),
    createdByName: row.author_name ?? null,
  };
}

function post(row) {
  if (!row) return null;
  return {
    id: num(row.id),
    classroomId: num(row.classroom_id),
    classroomName: row.classroom_name ?? null,
    authorId: num(row.author_id),
    authorName: row.author_name ?? null,
    title: row.title ?? null,
    body: row.body ?? null,
    mediaUrl: row.media_url ?? null,
    mediaType: row.media_type,
    postedAt: row.posted_at,
  };
}

function announcement(row) {
  if (!row) return null;
  return {
    id: num(row.id),
    title: row.title,
    body: row.body,
    audience: row.audience,
    classroomId: num(row.classroom_id),
    classroomName: row.classroom_name ?? null,
    authorId: num(row.author_id),
    authorName: row.author_name ?? null,
    publishedAt: row.published_at,
    expiresOn: row.expires_on ?? null,
    isRead: row.is_read === undefined ? undefined : bool(row.is_read),
  };
}

function event(row) {
  if (!row) return null;
  return {
    id: num(row.id),
    title: row.title,
    description: row.description ?? null,
    location: row.location ?? null,
    startsAt: row.starts_at,
    endsAt: row.ends_at ?? null,
    allDay: bool(row.all_day),
    audience: row.audience,
    classroomId: num(row.classroom_id),
    createdBy: num(row.created_by),
  };
}

function invoice(row) {
  if (!row) return null;
  return {
    id: num(row.id),
    childId: num(row.child_id),
    childName: row.first_name ? `${row.first_name} ${row.last_name}` : null,
    classroomName: row.classroom_name ?? null,
    number: row.number,
    periodLabel: row.period_label,
    description: row.description ?? null,
    amountCents: num(row.amount_cents),
    currency: row.currency,
    dueDate: row.due_date,
    issuedOn: row.issued_on,
    status: row.status,
    paidCents: row.paid_cents === undefined ? undefined : num(row.paid_cents),
    balanceCents:
      row.paid_cents === undefined ? undefined : num(row.amount_cents) - num(row.paid_cents),
  };
}

function payment(row) {
  if (!row) return null;
  return {
    id: num(row.id),
    invoiceId: num(row.invoice_id),
    amountCents: num(row.amount_cents),
    paidOn: row.paid_on,
    method: row.method,
    reference: row.reference ?? null,
    recordedBy: num(row.recorded_by),
  };
}

function message(row) {
  if (!row) return null;
  return {
    id: num(row.id),
    threadKey: row.thread_key,
    senderId: num(row.sender_id),
    senderName: row.sender_name ?? null,
    recipientId: num(row.recipient_id),
    recipientName: row.recipient_name ?? null,
    childId: num(row.child_id),
    subject: row.subject ?? null,
    body: row.body,
    sentAt: row.sent_at,
    readAt: row.read_at ?? null,
  };
}

function setting(row) {
  return { key: row.key, value: row.value };
}

module.exports = {
  bool,
  num,
  user,
  publicUser,
  classroom,
  child,
  guardian,
  attendance,
  dailyReport,
  observation,
  post,
  announcement,
  event,
  invoice,
  payment,
  message,
  setting,
};