'use strict';

/**
 * Row -> API mappers. These fix the camelCase contract that every view under
 * public/js relies on, including the keys that are deliberately `undefined`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const serialize = require('../src/lib/serialize');

test('a user row becomes the documented camelCase shape', () => {
  const user = serialize.user({
    id: '3',
    email: 'amy@sproutdesk.test',
    full_name: 'Amy Okafor',
    role: 'parent',
    phone: null,
    job_title: null,
    is_active: 1,
    last_login_at: null,
    created_at: '2026-09-01T08:00:00.000Z',
  });
  assert.deepEqual(user, {
    id: 3,
    email: 'amy@sproutdesk.test',
    fullName: 'Amy Okafor',
    role: 'parent',
    phone: null,
    jobTitle: null,
    isActive: true,
    lastLoginAt: null,
    createdAt: '2026-09-01T08:00:00.000Z',
  });
  assert.equal(serialize.user(null), null);
});

test('a child row joins the name and counts guardians only when asked to', () => {
  const row = {
    id: 5,
    first_name: 'Lena',
    last_name: 'Petrescu',
    date_of_birth: '2021-04-02',
    classroom_id: null,
    classroom_name: 'Sunflowers',
    enrollment_status: 'active',
    start_date: '2024-09-02',
    allergies: null,
    medical_notes: null,
    photo_url: null,
  };
  const child = serialize.child(row);
  assert.equal(child.fullName, 'Lena Petrescu');
  assert.equal(child.classroomName, 'Sunflowers');
  assert.equal(child.classroomId, null);
  assert.equal(child.guardianCount, undefined);

  assert.equal(serialize.child({ ...row, guardian_count: '2' }).guardianCount, 2);
});

test('a classroom keeps its lead teacher and child count', () => {
  const classroom = serialize.classroom({
    id: 1,
    name: 'Sunflowers',
    age_group: '3-4 years',
    capacity: '18',
    room_label: 'Room 2',
    lead_teacher_id: 2,
    lead_teacher_name: 'Mia Tanaka',
    notes: null,
  });
  assert.deepEqual(classroom, {
    id: 1,
    name: 'Sunflowers',
    ageGroup: '3-4 years',
    capacity: 18,
    roomLabel: 'Room 2',
    leadTeacherId: 2,
    leadTeacherName: 'Mia Tanaka',
    notes: null,
    childCount: undefined,
  });
});

test('an invoice exposes cents plus the derived balance', () => {
  const invoice = serialize.invoice({
    id: 11,
    child_id: 5,
    first_name: 'Lena',
    last_name: 'Petrescu',
    classroom_name: 'Sunflowers',
    number: 'INV-2026-09-0001',
    period_label: '2026-09',
    description: 'September tuition',
    amount_cents: 12000,
    currency: 'EUR',
    due_date: '2026-09-14',
    issued_on: '2026-09-01',
    status: 'partial',
    paid_cents: 5000,
  });
  assert.equal(invoice.amountCents, 12000);
  assert.equal(invoice.paidCents, 5000);
  assert.equal(invoice.balanceCents, 7000);
  assert.equal(invoice.periodLabel, '2026-09');
  assert.equal(invoice.childName, 'Lena Petrescu');
  assert.equal(invoice.currency, 'EUR');

  // The totals only exist when the query selected the payment sub-total.
  const bare = serialize.invoice({ id: 12, amount_cents: 100, status: 'unpaid' });
  assert.equal(bare.paidCents, undefined);
  assert.equal(bare.balanceCents, undefined);
  assert.equal(serialize.invoice(null), null);
});

test('attendance, reports, posts and announcements map their columns', () => {
  const attendance = serialize.attendance({
    id: 1,
    child_id: 5,
    first_name: 'Lena',
    last_name: 'Petrescu',
    attendance_date: '2026-09-26',
    status: 'late',
    check_in_time: '09:05',
    check_out_time: null,
    note: null,
    recorded_by: 2,
  });
  assert.deepEqual(attendance, {
    id: 1,
    childId: 5,
    childName: 'Lena Petrescu',
    date: '2026-09-26',
    status: 'late',
    checkInTime: '09:05',
    checkOutTime: null,
    note: null,
    recordedBy: 2,
  });

  const report = serialize.dailyReport({
    id: 4,
    child_id: 5,
    report_date: '2026-09-26',
    mood: 'happy',
    nap_minutes: 45,
    created_by: 2,
  });
  assert.equal(report.date, '2026-09-26');
  assert.equal(report.napMinutes, 45);
  assert.equal(report.lunch, null);
  assert.equal(report.teacherNote, null);

  const post = serialize.post({
    id: 8,
    classroom_id: 1,
    author_id: 2,
    media_type: 'image',
    posted_at: '2026-09-26T09:00:00.000Z',
  });
  assert.equal(post.classroomId, 1);
  assert.equal(post.mediaType, 'image');
  assert.equal(post.mediaUrl, null);
  assert.equal(post.authorName, null);

  const announcement = serialize.announcement({
    id: 2,
    title: 'Closed on Friday',
    body: 'See you on Monday.',
    audience: 'all',
    published_at: '2026-09-25T07:00:00.000Z',
  });
  assert.equal(announcement.isRead, undefined);
  assert.equal(announcement.expiresOn, null);
  assert.equal(
    serialize.announcement({
      id: 3,
      title: 'Trip',
      body: 'Bring a hat.',
      audience: 'parents',
      published_at: '2026-09-25T07:00:00.000Z',
      is_read: 1,
    }).isRead,
    true,
  );
});

test('payments and messages carry their foreign keys', () => {
  const payment = serialize.payment({
    id: 3,
    invoice_id: 11,
    amount_cents: 5000,
    paid_on: '2026-09-10',
    method: 'bank_transfer',
    reference: null,
    recorded_by: 1,
  });
  assert.deepEqual(payment, {
    id: 3,
    invoiceId: 11,
    amountCents: 5000,
    paidOn: '2026-09-10',
    method: 'bank_transfer',
    reference: null,
    recordedBy: 1,
  });

  const message = serialize.message({
    id: 9,
    thread_key: '1:7:5',
    sender_id: 1,
    sender_name: 'Amy Okafor',
    recipient_id: 2,
    recipient_name: 'Mia Tanaka',
    child_id: 5,
    subject: null,
    body: 'Lena had a lovely morning.',
    sent_at: '2026-09-20T10:00:00.000Z',
    read_at: null,
  });
  assert.equal(message.threadKey, '1:7:5');
  assert.equal(message.childId, 5);
  assert.equal(message.readAt, null);
  assert.equal(message.subject, null);
  assert.equal(message.senderName, 'Amy Okafor');
});

test('an event keeps its audience and all-day flag', () => {
  const event = serialize.event({
    id: 6,
    title: 'Parents evening',
    description: null,
    location: 'Main hall',
    starts_at: '2026-10-01T17:00:00.000Z',
    ends_at: null,
    all_day: 0,
    audience: 'parents',
    classroom_id: null,
    created_by: 1,
  });
  assert.equal(event.allDay, false);
  assert.equal(event.audience, 'parents');
  assert.equal(event.endsAt, null);
  assert.equal(event.location, 'Main hall');
  assert.equal(event.classroomId, null);
});
