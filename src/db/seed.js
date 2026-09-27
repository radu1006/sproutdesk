'use strict';

/**
 * Demo data for a fresh install.
 *
 *   node src/db/seed.js            -> seed, but only when the database is empty
 *   node src/db/seed.js --force    -> wipe the demo tables and seed again
 *
 * All accounts below are fictional and only meant for local evaluation.
 * Change or delete them before exposing the application to real users.
 */

require('dotenv').config();

const config = require('../config');
const db = require('../db');
const dates = require('../lib/dates');
const { buildInsert } = require('../lib/sql');
const { hashPassword } = require('../lib/validate');

const DEMO_PASSWORD_TEACHER = 'Teacher123!';
const DEMO_PASSWORD_PARENT = 'Parent123!';

const USERS = [
  {
    key: 'admin',
    email: config.seed.adminEmail,
    password: config.seed.adminPassword,
    fullName: 'Dana Whitfield',
    role: 'admin',
    jobTitle: 'Centre Director',
    phone: '+1 555 0101',
  },
  {
    key: 'teacherSunbeams',
    email: 'mia.tanaka@sproutdesk.test',
    password: DEMO_PASSWORD_TEACHER,
    fullName: 'Mia Tanaka',
    role: 'teacher',
    jobTitle: 'Room Educator - Sunbeams',
    phone: '+1 555 0102',
  },
  {
    key: 'teacherRainbows',
    email: 'lucas.moreau@sproutdesk.test',
    password: DEMO_PASSWORD_TEACHER,
    fullName: 'Lucas Moreau',
    role: 'teacher',
    jobTitle: 'Room Educator - Rainbows',
    phone: '+1 555 0103',
  },
  {
    key: 'parentPetrescu',
    email: 'elena.petrescu@sproutdesk.test',
    password: DEMO_PASSWORD_PARENT,
    fullName: 'Elena Petrescu',
    role: 'parent',
    phone: '+1 555 0110',
  },
  {
    key: 'parentOkafor',
    email: 'samuel.okafor@sproutdesk.test',
    password: DEMO_PASSWORD_PARENT,
    fullName: 'Samuel Okafor',
    role: 'parent',
    phone: '+1 555 0111',
  },
  {
    key: 'parentNair',
    email: 'priya.nair@sproutdesk.test',
    password: DEMO_PASSWORD_PARENT,
    fullName: 'Priya Nair',
    role: 'parent',
    phone: '+1 555 0112',
  },
  {
    key: 'parentWeber',
    email: 'nina.weber@sproutdesk.test',
    password: DEMO_PASSWORD_PARENT,
    fullName: 'Nina Weber',
    role: 'parent',
    phone: '+1 555 0113',
  },
];

const CLASSROOMS = [
  {
    key: 'sunbeams',
    name: 'Sunbeams',
    ageGroup: '2 - 3 years',
    capacity: 14,
    roomLabel: 'Room A',
    leadTeacher: 'teacherSunbeams',
    notes: 'Free-flow play room with a covered outdoor terrace.',
  },
  {
    key: 'rainbows',
    name: 'Rainbows',
    ageGroup: '3 - 5 years',
    capacity: 18,
    roomLabel: 'Room B',
    leadTeacher: 'teacherRainbows',
    notes: 'Pre-school room with a literacy corner and garden plot.',
  },
];

const CHILDREN = [
  { key: 'matei', firstName: 'Matei', lastName: 'Petrescu', dob: '2023-04-12', classroom: 'sunbeams', guardian: 'parentPetrescu', relationship: 'mother' },
  { key: 'ines', firstName: 'Ines', lastName: 'Okafor', dob: '2023-07-30', classroom: 'sunbeams', guardian: 'parentOkafor', relationship: 'father' },
  { key: 'theo', firstName: 'Theo', lastName: 'Nair', dob: '2023-02-08', classroom: 'sunbeams', guardian: 'parentNair', relationship: 'mother' },
  { key: 'ana', firstName: 'Ana', lastName: 'Okafor', dob: '2023-11-21', classroom: 'sunbeams', guardian: 'parentOkafor', relationship: 'father' },
  { key: 'sofia', firstName: 'Sofia', lastName: 'Petrescu', dob: '2022-09-05', classroom: 'rainbows', guardian: 'parentPetrescu', relationship: 'mother' },
  { key: 'daniel', firstName: 'Daniel', lastName: 'Okafor', dob: '2022-06-14', classroom: 'rainbows', guardian: 'parentOkafor', relationship: 'father' },
  { key: 'mira', firstName: 'Mira', lastName: 'Nair', dob: '2022-12-02', classroom: 'rainbows', guardian: 'parentNair', relationship: 'mother' },
  { key: 'jonas', firstName: 'Jonas', lastName: 'Weber', dob: '2022-03-19', classroom: 'rainbows', guardian: 'parentWeber', relationship: 'mother' },
];

async function insert(table, data) {
  const { sql, params } = buildInsert(table, data);
  const result = await db.run(sql, params);
  return result.id;
}

async function countRows(table) {
  const row = await db.get(`SELECT COUNT(*) AS total FROM ${table}`);
  return Number(row?.total ?? 0);
}

async function clearDemoData() {
  // Order matters: children/grandchildren first.
  for (const table of [
    'announcement_reads',
    'payments',
    'messages',
    'invoices',
    'daily_reports',
    'observations',
    'attendance',
    'class_posts',
    'announcements',
    'events',
    'guardians',
    'children',
    'classrooms',
    'sessions',
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
  await db.run('DELETE FROM users');
}

async function seed({ force = false } = {}) {
  const existingUsers = await countRows('users');
  if (existingUsers > 0 && !force) {
    return { skipped: true, reason: 'the database already contains users' };
  }

  const now = dates.nowIso();
  const today = dates.todayIso();
  const weekdays = dates.lastWeekdays(5, today);
  const thisPeriod = dates.periodLabel(today);
  const lastPeriod = dates.periodLabel(dates.addMonths(today, -1));
  const summary = {};

  await db.tx(async () => {
    if (force) await clearDemoData();

    // ---------------------------------------------------------------- users
    const userIds = {};
    for (const user of USERS) {
      userIds[user.key] = await insert('users', {
        email: user.email,
        password_hash: await hashPassword(user.password),
        full_name: user.fullName,
        role: user.role,
        phone: user.phone ?? null,
        job_title: user.jobTitle ?? null,
        is_active: 1,
        created_at: now,
        updated_at: now,
      });
    }

    // ----------------------------------------------------------- classrooms
    const classroomIds = {};
    for (const room of CLASSROOMS) {
      classroomIds[room.key] = await insert('classrooms', {
        name: room.name,
        age_group: room.ageGroup,
        capacity: room.capacity,
        room_label: room.roomLabel,
        lead_teacher_id: userIds[room.leadTeacher],
        notes: room.notes,
        created_at: now,
        updated_at: now,
      });
    }

    // ------------------------------------------- children and their parents
    const childIds = {};
    for (const child of CHILDREN) {
      const id = await insert('children', {
        first_name: child.firstName,
        last_name: child.lastName,
        date_of_birth: child.dob,
        classroom_id: classroomIds[child.classroom],
        enrollment_status: 'active',
        start_date: dates.addMonths(child.dob, 26) < today ? dates.addMonths(child.dob, 26) : today,
        allergies: null,
        medical_notes: null,
        created_at: now,
        updated_at: now,
      });
      childIds[child.key] = id;
      await insert('guardians', {
        child_id: id,
        user_id: userIds[child.guardian],
        relationship: child.relationship,
        is_primary_contact: 1,
        created_at: now,
      });
    }

    // Allergies / medical notes worth demonstrating
    await db.run('UPDATE children SET allergies = ? WHERE id = ?', ['Peanuts', childIds.ines]);
    await db.run('UPDATE children SET medical_notes = ? WHERE id = ?', [
      'Inhaler kept in the room A first-aid box.',
      childIds.theo,
    ]);

    // ----------------------------------------------------------- attendance
    const statusPattern = ['present', 'present', 'present', 'late', 'present', 'sick', 'absent'];
    const attendanceIds = Object.values(childIds);
    for (let childIndex = 0; childIndex < attendanceIds.length; childIndex += 1) {
      const childId = attendanceIds[childIndex];
      for (let dayIndex = 0; dayIndex < weekdays.length; dayIndex += 1) {
        const day = weekdays[dayIndex];
        const isToday = day === today;
        // Today every child is in, the pattern only applies to previous days.
        const status = isToday ? 'present' : statusPattern[(childIndex + dayIndex) % statusPattern.length];
        const arrived = status === 'present' || status === 'late';
        await insert('attendance', {
          child_id: childId,
          attendance_date: day,
          status,
          check_in_time: arrived ? (status === 'late' ? '09:05' : '08:15') : null,
          check_out_time: arrived && isToday ? null : arrived ? '16:30' : null,
          note: status === 'sick' ? 'Parent called in the morning.' : null,
          recorded_by: day === today ? userIds.teacherSunbeams : userIds.admin,
          created_at: now,
          updated_at: now,
        });
      }
    }

    // -------------------------------------------------------- daily reports
    const moods = ['happy', 'energetic', 'calm', 'tired'];
    const appetites = ['all', 'most', 'some'];
    const activityIdeas = [
      'Water play and sand tray exploration.',
      'Story circle: "The Very Busy Spider", then puppet retelling.',
      'Finger painting with red and yellow tones.',
      'Building a giant tower from cardboard blocks.',
      'Music morning: rhythm sticks and action songs.',
    ];
    for (let index = 0; index < attendanceIds.length; index += 1) {
      const childId = attendanceIds[index];
      await insert('daily_reports', {
        child_id: childId,
        report_date: today,
        mood: moods[index % moods.length],
        breakfast: appetites[index % appetites.length],
        lunch: appetites[(index + 1) % appetites.length],
        snack: appetites[(index + 2) % appetites.length],
        nap_minutes: 45 + (index % 3) * 20,
        toilet_notes: index % 2 === 0 ? 'Dry all day - well done!' : 'One reminder needed after lunch.',
        activities: activityIdeas[index % activityIdeas.length],
        teacher_note:
          index % 3 === 0
            ? 'Shared toys happily with friends and helped tidy the book corner.'
            : 'A calm, curious day - lots of questions during the nature walk.',
        created_by: userIds.teacherSunbeams,
        created_at: now,
        updated_at: now,
      });
    }

    // --------------------------------------------------------- observations
    const areas = ['language', 'motor', 'social', 'cognitive', 'creative', 'self_care'];
    const levels = ['emerging', 'developing', 'secure'];
    const observationNotes = [
      'Used three-word sentences to describe the picture.',
      'Climbed the low frame without support and landed on two feet.',
      'Invited a friend to join the puzzle table.',
      'Sorted the counting bears by colour and size.',
      'Built a "castle" and explained who lives inside.',
      'Washed hands independently before lunch.',
    ];
    for (let index = 0; index < attendanceIds.length; index += 1) {
      const childId = attendanceIds[index];
      for (let offset = 0; offset < 2; offset += 1) {
        const position = (index + offset) % areas.length;
        await insert('observations', {
          child_id: childId,
          area: areas[position],
          level: levels[(index + offset) % levels.length],
          note: observationNotes[position],
          observed_on: weekdays[weekdays.length - 1 - (offset % weekdays.length)],
          created_by: userIds.teacherSunbeams,
          created_at: now,
          updated_at: now,
        });
      }
    }

    // ----------------------------------------------------------- class feed
    const posts = [
      {
        classroom: 'sunbeams',
        title: 'Autumn treasure hunt',
        body: 'The Sunbeams collected leaves, conkers and pine cones. We sorted them by size and colour before adding them to the nature table.',
        days: 1,
      },
      {
        classroom: 'sunbeams',
        title: 'Music morning',
        body: 'We practised loud and quiet sounds with rhythm sticks. There were some very enthusiastic conductors today!',
        days: 3,
      },
      {
        classroom: 'rainbows',
        title: 'Garden project update',
        body: 'Our bean seeds have sprouted. The children measured them with a ribbon ruler and wrote the numbers on the chart.',
        days: 2,
      },
      {
        classroom: 'rainbows',
        title: 'Show and tell',
        body: 'Thank you for sending in such interesting objects. The children took turns asking questions to the presenter.',
        days: 5,
      },
    ];
    for (const post of posts) {
      await insert('class_posts', {
        classroom_id: classroomIds[post.classroom],
        author_id: userIds[post.classroom === 'sunbeams' ? 'teacherSunbeams' : 'teacherRainbows'],
        title: post.title,
        body: post.body,
        media_url: null,
        media_type: 'none',
        posted_at: new Date(Date.now() - post.days * 86400000).toISOString(),
        created_at: now,
        updated_at: now,
      });
    }

    // -------------------------------------------------------- announcements
    const announcements = [
      {
        title: 'Parent-teacher meetings open for booking',
        body: 'Bookable slots are now available for the autumn parent-teacher meetings. Each conversation lasts 15 minutes; sign-up sheets are at the entrance desk.',
        audience: 'parents',
        days: -2,
        expires: dates.addDays(today, 21),
      },
      {
        title: 'Photo day next Thursday',
        body: 'The photographer will visit in the morning. Please send the children in their centre polo shirts; no need to dress up beyond that.',
        audience: 'all',
        days: -5,
        expires: dates.addDays(today, 10),
      },
      {
        title: 'Staff training: paediatric first aid refresher',
        body: 'All educators are booked on the refresher course on Friday afternoon. Rooms will close at 13:00; the after-school club operates as usual.',
        audience: 'teachers',
        days: -1,
        expires: dates.addDays(today, 14),
      },
    ];
    const readUserIds = [userIds.parentPetrescu, userIds.teacherSunbeams];
    for (const announcement of announcements) {
      const id = await insert('announcements', {
        title: announcement.title,
        body: announcement.body,
        audience: announcement.audience,
        classroom_id: null,
        author_id: userIds.admin,
        published_at: new Date(Date.now() + announcement.days * 86400000).toISOString(),
        expires_on: announcement.expires,
        created_at: now,
        updated_at: now,
      });
      for (const userId of readUserIds) {
        await insert('announcement_reads', {
          announcement_id: id,
          user_id: userId,
          read_at: now,
        });
      }
    }

    // --------------------------------------------------------------- events
    const events = [
      { title: 'Autumn festival parade', description: 'Children parade through the garden with lanterns they made in class. Families welcome from 16:00.', location: 'Centre garden', days: 9, hour: 16, audience: 'all' },
      { title: 'Parent-teacher meetings', description: 'Individual 15 minute conversations with your child key educator.', location: 'Rooms A and B', days: 16, hour: 17, audience: 'parents' },
      { title: 'Photo day', description: 'Class and individual photographs in the morning.', location: 'Activity hall', days: 4, hour: 9, audience: 'all' },
      { title: 'Educator team planning afternoon', description: 'Rooms close at 13:00 for curriculum planning.', location: 'Staff room', days: 11, hour: 13, audience: 'teachers' },
    ];
    for (const event of events) {
      const startDay = dates.addDays(today, event.days);
      await insert('events', {
        title: event.title,
        description: event.description,
        location: event.location,
        starts_at: `${startDay}T${String(event.hour).padStart(2, '0')}:00:00.000Z`,
        ends_at: `${startDay}T${String(event.hour + 2).padStart(2, '0')}:00:00.000Z`,
        all_day: 0,
        audience: event.audience,
        classroom_id: null,
        created_by: userIds.admin,
        created_at: now,
        updated_at: now,
      });
    }

    // ------------------------------------------------------ invoices & fees
    const fullTimeCents = 85000;
    const partTimeCents = 52000;
    const childEntries = Object.entries(childIds);
    let invoiceSequence = 0;
    for (let index = 0; index < childEntries.length; index += 1) {
      const [, childId] = childEntries[index];
      const amount = index % 3 === 0 ? partTimeCents : fullTimeCents;
      for (const period of [lastPeriod, thisPeriod]) {
        invoiceSequence += 1;
        const issuedOn = `${period}-01`;
        const isCurrent = period === thisPeriod;
        const number = `INV-${period}-${String(invoiceSequence).padStart(4, '0')}`;
        const invoiceId = await insert('invoices', {
          child_id: childId,
          number,
          period_label: period,
          description: isCurrent
            ? 'Monthly care fee - current month'
            : 'Monthly care fee - previous month',
          amount_cents: amount,
          currency: 'USD',
          due_date: dates.addDays(issuedOn, 14),
          issued_on: issuedOn,
          status: isCurrent ? 'unpaid' : 'paid',
          created_by: userIds.admin,
          created_at: now,
          updated_at: now,
        });
        if (!isCurrent) {
          await insert('payments', {
            invoice_id: invoiceId,
            amount_cents: amount,
            paid_on: dates.addDays(issuedOn, 8),
            method: index % 2 === 0 ? 'bank_transfer' : 'card',
            reference: `REF-${invoiceSequence}`,
            recorded_by: userIds.admin,
            created_at: now,
          });
        }
      }
    }

    // -------------------------------------------------------------- messages
    const threads = [
      {
        from: 'parentPetrescu',
        to: 'teacherSunbeams',
        child: 'matei',
        subject: 'Nap time',
        body: 'Good morning! Matei was a little unsettled last night, could you keep nap time quiet for him today? Thank you!',
        minutesAgo: 180,
        reply: {
          body: 'Of course - I have set his mat in the quiet corner and will let you know how he sleeps. He was cheerful at drop-off.',
          minutesAgo: 150,
          read: true,
        },
      },
      {
        from: 'parentOkafor',
        to: 'admin',
        child: 'daniel',
        subject: 'Invoice question',
        body: 'Hello, could you confirm whether the craft materials contribution is included in this month fee?',
        minutesAgo: 60,
        reply: null,
      },
    ];
    for (const thread of threads) {
      const senderId = userIds[thread.from];
      const recipientId = userIds[thread.to];
      const threadKey = [senderId, recipientId].sort((a, b) => a - b).join(':');
      const sentAt = new Date(Date.now() - thread.minutesAgo * 60000).toISOString();
      const firstId = await insert('messages', {
        thread_key: threadKey,
        sender_id: senderId,
        recipient_id: recipientId,
        child_id: childIds[thread.child],
        subject: thread.subject,
        body: thread.body,
        sent_at: sentAt,
        read_at: null,
        created_at: sentAt,
      });
      if (thread.reply) {
        const replyAt = new Date(Date.now() - thread.reply.minutesAgo * 60000).toISOString();
        await insert('messages', {
          thread_key: threadKey,
          sender_id: recipientId,
          recipient_id: senderId,
          child_id: childIds[thread.child],
          subject: thread.subject,
          body: thread.reply.body,
          sent_at: replyAt,
          read_at: thread.reply.read ? now : null,
          created_at: replyAt,
        });
        await db.run('UPDATE messages SET read_at = ? WHERE id = ?', [now, firstId]);
      }
    }

    // ------------------------------------------------------- summary counters
    summary.attendance = await countRows('attendance');
    summary.dailyReports = await countRows('daily_reports');
    summary.observations = await countRows('observations');
    summary.posts = await countRows('class_posts');
    summary.announcements = await countRows('announcements');
    summary.events = await countRows('events');
    summary.invoices = await countRows('invoices');
    summary.messages = await countRows('messages');
    summary.users = Object.keys(userIds).length;
    summary.classrooms = Object.keys(classroomIds).length;
    summary.children = Object.keys(childIds).length;
  });

  summary.skipped = false;
  return summary;
}

async function main() {
  const force = process.argv.includes('--force');
  try {
    const result = await seed({ force });
    if (result.skipped) {
      console.log(`SproutDesk: seed skipped (${result.reason}). Use "npm run seed -- --force" to overwrite.`);
    } else {
      console.log('SproutDesk: demo data created.');
      for (const [key, value] of Object.entries(result)) {
        if (key === 'skipped') continue;
        console.log(`  ${key.padEnd(14)} ${value}`);
      }
      console.log('');
      console.log('Demo sign-in accounts:');
      console.log(`  admin    ${config.seed.adminEmail} / ${config.seed.adminPassword}`);
      console.log(`  teacher  mia.tanaka@sproutdesk.test / ${DEMO_PASSWORD_TEACHER}`);
      console.log(`  teacher  lucas.moreau@sproutdesk.test / ${DEMO_PASSWORD_TEACHER}`);
      console.log(`  parent   elena.petrescu@sproutdesk.test / ${DEMO_PASSWORD_PARENT}`);
      console.log(`  parent   samuel.okafor@sproutdesk.test / ${DEMO_PASSWORD_PARENT}`);
      console.log('');
      console.log('Change these passwords (or delete the accounts) before going live.');
    }
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Seeding failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { seed, USERS, CLASSROOMS, CHILDREN, DEMO_PASSWORD_TEACHER, DEMO_PASSWORD_PARENT };

