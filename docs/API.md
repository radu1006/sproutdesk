# API reference

Every endpoint lives under `/api` and speaks JSON.

* Success: `{ "data": … }` — the payload is an object or an array, never wrapped twice.
* Error: `{ "error": { "message": "…", "code": "…" } }` with a matching status.
* Bodies are JSON (`Content-Type: application/json`); uploads are `multipart/form-data`.
* Authentication is the `sproutdesk_session` cookie created by `POST /api/auth/login`.
* Dates are `YYYY-MM-DD`, timestamps are ISO-8601 UTC, money is **integer cents**.
* List endpoints accept `?limit=`; every route clamps it to its own safe range
  (defaults run from 5 to 200, caps from 50 to 500). A value that cannot be read
  as a positive whole number falls back to the route's default instead of failing.

## Errors

| Status | `code` values | Meaning |
| --- | --- | --- |
| 400 | `bad_request`, `missing_field`, `invalid_value`, `invalid_json`, `weak_password`, `invalid_password`, `no_file`, `upload_error`, `unsupported_media` | The request could not be validated |
| 400 | `child_has_invoices`, `classroom_not_empty`, `number_conflict`, `invoice_void` | A delete, an invoice number allocation or a change to a void invoice was refused; each carries its own meaning |
| 401 | `unauthenticated`, `invalid_credentials`, `account_disabled` | No session or an expired one (the SPA then shows the sign-in screen), a rejected sign-in, or a deactivated account |
| 403 | `forbidden`, `insufficient_role` | Signed in but not allowed |
| 404 | `not_found` | Unknown endpoint or missing row |
| 409 | `conflict` | Value already in use, or a row is still referenced |
| 413 | `file_too_large`, `payload_too_large` | Upload above `MAX_UPLOAD_MB`, or a JSON body above the 1mb parser limit |
| 500 | `internal_error` | Unexpected failure; details stay in the server log |

## Roles and visibility

| Role | Scope |
| --- | --- |
| `admin` | the whole centre; the only role that may manage people, classrooms, billing and settings |
| `teacher` | the classrooms they lead (`classrooms.lead_teacher_id`) and their children |
| `parent` | only their own children (rows in `guardians`) |

Enforced in `src/lib/access.js`. List endpoints silently narrow to what the
caller may see; single-record endpoints answer `403` when the row is out of
reach and `404` when it does not exist. Every route below is at least
`requireAuth`; `admin` / `teacher` marks the extra `requireRole(...)` guard.

## Auth

| Endpoint | Access | Notes |
| --- | --- | --- |
| `POST /api/auth/login` | public | `{ email, password }` → `{ data: { user, school, expiresAt } }`, sets the cookie |
| `POST /api/auth/logout` | any | deletes the session row and clears the cookie |
| `GET /api/auth/me` | any | `{ data: { user, sessionExpiresAt, school } }` — used on boot |
| `PATCH /api/auth/me` | any | `fullName` (required, ≤120), `phone` (≤40), `jobTitle` (≤120) |
| `POST /api/auth/me/password` | any | `currentPassword`, `newPassword` (≥8 characters) |

`user` = `{ id, email, fullName, role, phone, jobTitle, isActive, lastLoginAt, createdAt }`.
`school` is the settings object documented under *Settings*.

## Dashboard

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /api/dashboard` | any | One role-aware payload: counts, today's attendance breakdown, unread announcements and messages, upcoming events, recent feed activity, and the role's own block (billing, classrooms or children). |

Every role receives the same envelope, so the home screen needs a single request:

```json
{
  "role": "admin",
  "date": "2026-09-26",
  "weekEnding": "2026-10-03",
  "currency": "USD",
  "cards": [{ "key": "children", "label": "Active children", "value": 24 }],
  "attendance": {
    "date": "2026-09-26", "expected": 24, "recorded": 20, "notRecorded": 4,
    "present": 18, "absent": 1, "late": 1, "sick": 0, "holiday": 0
  },
  "announcements": [],
  "upcomingEvents": [],
  "feed": [],
  "unread": { "messages": 2, "announcements": 1 }
}
```

* `date` is the server's today, `weekEnding` is that date plus seven days.
* `currency` is the centre currency saved in Settings (`DEFAULT_CURRENCY` on a
  fresh install); each invoice keeps its own currency.
* `cards` are the tiles at the top of the screen, as `{ key, label, value }`:
  `children`, `classrooms`, `staff`, `families` for an admin; `children`,
  `classrooms`, `recorded`, `unmarked` for a teacher; `children`, `present`,
  `reports`, `invoices` for a parent.
* `announcements`, `upcomingEvents` and `feed` carry five rows each, already
  narrowed to what the caller may see (a teacher or parent only gets their own
  classrooms and audience); `feed` holds serialised class posts.
* `unread` counts the caller's unread messages plus the unread announcements
  they can see (that second count inspects at most the 200 most recent).
* `attendance` always has `date`, `expected`, `recorded` and `notRecorded`;
  `present`, `absent`, `late`, `sick` and `holiday` are added for admins and
  teachers, while parents get the four summary numbers only.

Role-specific blocks:

| Role | Extra fields |
| --- | --- |
| admin | `billing` = `{ period, openCount, billedCents, paidCents, openCents, overdueCents }` for this period's unpaid and partly paid invoices, plus `observationsThisMonth` |
| teacher | `classrooms` (serialised, each with `childCount`), `unmarkedChildren` (up to 25 serialised children with no attendance row today) and `observationsThisMonth` |
| parent | `children` = `[{ child, attendance, hasDailyReport }]` (`attendance` is `null` until the room marks the day) and `billing` = `{ openCount, billedCents, paidCents, balanceCents }` |

Money is **integer cents** in `currency`; `openCents` / `balanceCents` are what is
still owed (`billedCents - paidCents`) and `overdueCents` adds up the invoices
that were due before `date`.

## Users (staff & families)

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /api/users` | admin | `?role=admin|teacher|parent`, `?q=` free-text over name/email |
| `POST /api/users` | admin | `fullName` (≤120), `email`, `role`, `password` (≥8), `phone` (≤40), `jobTitle` (≤120) |
| `GET /api/users/:id` | admin | single user |
| `PATCH /api/users/:id` | admin | any of `fullName`, `email`, `role`, `phone`, `jobTitle`, `isActive`; `password` resets it |
| `DELETE /api/users/:id` | admin | refuses to remove the last administrator |

## Classrooms

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /api/classrooms` | any | narrowed for teachers and parents; each row carries `childCount` |
| `POST /api/classrooms` | admin | `name` (≤80), `ageGroup`, `capacity` (1-200), `roomLabel`, `leadTeacherId`, `notes` |
| `GET /api/classrooms/:id` | any | classroom with its roster |
| `PATCH /api/classrooms/:id` | admin | any of the create fields |
| `DELETE /api/classrooms/:id` | admin | children survive; their `classroom_id` becomes `NULL` |

## Children

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /api/children` | any | `?classroomId=`, `?status=`, `?q=`, `?limit=`; parents are always limited to their own children |
| `POST /api/children` | admin | `firstName`, `lastName`, `dateOfBirth` (not in the future), `classroomId`, `enrollmentStatus`, `startDate`, `allergies`, `medicalNotes`, `photoUrl` |
| `GET /api/children/:id` | any | child, classroom and guardians |
| `PATCH /api/children/:id` | admin | any create field, including `photoUrl` |
| `DELETE /api/children/:id` | admin | cascades attendance, reports, observations, guardians and invoices |
| `GET /api/children/:id/guardians` | any | the linked family accounts |
| `POST /api/children/:id/guardians` | admin | `userId`, `relationship` (`mother` \| `father` \| `guardian` \| `other`), `isPrimaryContact` |
| `DELETE /api/children/:id/guardians/:guardianId` | admin | unlinks a family account |

Child payloads use the serialised shape `{ id, firstName, lastName, fullName,
dateOfBirth, classroomId, classroomName, enrollmentStatus, startDate, allergies,
medicalNotes, photoUrl, guardianCount }`.

## Attendance

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /api/attendance` | any | `?date=` (default today), `?classroomId=`, `?childId=`; parents only ever see their own children |
| `GET /api/attendance/summary` | any | `?from=` (default 30 days back), `?to=` (default today), `?classroomId=` — per-status counts and daily totals |
| `POST /api/attendance` | admin, teacher | `childId`, `date`, `status` (`present`, `absent`, `late`, `sick` or `holiday`), `checkInTime`, `checkOutTime` (`HH:MM`), `note` |
| `POST /api/attendance/bulk` | admin, teacher | `{ date, entries: [{ childId, status, checkInTime, note }] }` — 1 to 200 rows, upserted per child and day |
| `DELETE /api/attendance/:id` | admin, teacher | removes one row |

## Daily reports

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /api/daily-reports` | any | `?childId=`, `?from=`, `?to=`, `?date=`, `?classroomId=` |
| `GET /api/daily-reports/:id` | any | single report |
| `PUT /api/daily-reports` | admin, teacher | Upserts by `childId` + `date`; `mood` (`happy`, `calm`, `tired`, `upset`, `energetic`), `breakfast`/`lunch`/`snack` (`all`, `most`, `some`, `none`), `napMinutes` (0-720), `toiletNotes`, `activities`, `teacherNote` |
| `DELETE /api/daily-reports/:id` | admin, teacher | removes a report |

## Observations

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /api/observations` | any | `?childId=`, `?area=`, `?from=` (default 90 days back), `?to=` |
| `GET /api/observations/progress/:childId` | any | counts per learning area and level, for the progress view |
| `POST /api/observations` | admin, teacher | `childId`, `area` (`language`, `motor`, `social`, `cognitive`, `creative`, `self_care`), `level` (`emerging`, `developing`, `secure`), `observedOn`, `note` |
| `PATCH /api/observations/:id` | admin, teacher | `observedOn` (never a future date), `area`, `level`, `note` |
| `DELETE /api/observations/:id` | admin, teacher | removes an observation |

## Class feed

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /api/posts` | any | `?classroomId=`; parents see the classrooms of their children |
| `POST /api/posts` | admin, teacher | `classroomId` plus at least one of `title` (≤140), `body` (≤4000) or `mediaUrl`; `mediaType` is `none`, `image` or `video` |
| `PATCH /api/posts/:id` | admin, teacher | `title`, `body`, `mediaUrl`, `mediaType` |
| `DELETE /api/posts/:id` | admin, teacher | removes a post |

## Announcements

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /api/announcements` | any | `?classroomId=`, `?active=` (defaults to true, hides expired notices), `?unreadOnly=`, `?limit=`; families receive the notices addressed to everyone or to parents plus their own classroom's |
| `GET /api/announcements/:id` | any | single announcement |
| `GET /api/announcements/:id/reads` | admin, teacher | who has already read it |
| `POST /api/announcements` | admin, teacher | `title` (≤160), `body` (≤6000), `audience` (`all`, `teachers`, `parents`), `classroomId`, `expiresOn`, `publishedAt` |
| `PATCH /api/announcements/:id` | admin, teacher | any of `title`, `body`, `audience`, `expiresOn`, `publishedAt`, `classroomId` |
| `DELETE /api/announcements/:id` | admin, teacher | removes an announcement |
| `POST /api/announcements/:id/read` | any | marks it read for the caller — this is what feeds the sidebar badge |

Announcement payloads add `isRead` when the request comes from a signed-in user.

## Calendar (events)

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /api/events` | any | `?from=` (default 30 days back), `?to=` (default 60 days ahead) |
| `GET /api/events/upcoming` | any | the next events in the default window |
| `POST /api/events` | admin, teacher | `title` (≤160), `startsAt` (ISO-8601, required), `endsAt` (must not precede `startsAt`), `allDay`, `audience`, `classroomId`, `description`, `location` |
| `PATCH /api/events/:id` | admin, teacher | any of the create fields |
| `DELETE /api/events/:id` | admin, teacher | removes an event |

Event payload: `{ id, title, description, location, startsAt, endsAt, allDay,
audience, classroomId, createdBy }`.

## Billing

Responses always carry money as **integer cents**. In requests, `amount` is the
decimal figure as typed (`120` or `"120.50"`); the server rounds it to the
nearest cent (`src/lib/validate.js` → `v.money`).

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /api/invoices` | any | `?childId=`, `?status=` (`unpaid`, `partial`, `paid`, `void`), `?period=` (`YYYY-MM`), `?limit=`; families are limited to their children's invoices |
| `GET /api/invoices/summary` | admin | `?period=` (defaults to the current month) → `{ period, invoiceCount, billedCents, paidCents, openCents, overdueCents, currency }`; void invoices are left out |
| `GET /api/invoices/:id` | any (own scope) | `{ invoice, payments }`, payments newest first |
| `POST /api/invoices` | admin | `childId` and `amount` (both required), `issuedOn` (default today), `period` (defaults to the issue month), `dueDate` (default issued + 14 days), `description` (≤500), `currency` (defaults to the centre currency), `number` (numbered per period when omitted). A new invoice always starts `unpaid`. |
| `PATCH /api/invoices/:id` | admin | `amount`, `description`, `dueDate`, `issuedOn`, `period`, `currency`, `status`. A voided invoice cannot be edited unless you send `status` to un-void it. |
| `DELETE /api/invoices/:id` | admin | deletes the invoice with its payments → `{ deleted: true, invoiceId }` |
| `POST /api/invoices/:id/payments` | admin | `amount` (required), `paidOn` (default today), `method` (`cash`, `bank_transfer`, `card`, `other` — default `bank_transfer`), `reference` (≤120). Answers 201 with `{ payment, invoice, paidCents }` and recalculates the status: nothing paid ⇒ `unpaid`, part paid ⇒ `partial`, fully covered ⇒ `paid`; `void` stays `void` (a void invoice cannot be paid: `400 invoice_void`). |
| `DELETE /api/invoices/:id/payments/:paymentId` | admin | reverses a payment and recalculates the status → `{ deleted: true, paymentId, invoice, paidCents }` |

Invoice payload: `{ id, childId, childName, classroomName, number, periodLabel,
description, amountCents, paidCents, balanceCents, currency, dueDate, issuedOn,
status }`. `paidCents` and `balanceCents` come from a payment sub-select, so they
are filled in everywhere the API returns an invoice.
Payment payload: `{ id, invoiceId, amountCents, paidOn, method, reference, recordedBy }`.

## Messages

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /api/messages/contacts` | any | `[{ id, fullName, role, email }]` — the people this account may write to: staff for administrators and teachers, and for a family the staff of their children plus the other guardians of those children |
| `GET /api/messages` | any | conversation list (last message and unread flag per partner) |
| `GET /api/messages/unread` | any | `{ unread }` — the total for the sidebar badge |
| `GET /api/messages/thread/:userId` | any | → `{ partner: { id, fullName, role, email }, messages }` (newest last, at most 500); `403` if they are outside your circle, and everything addressed to you in that thread is stamped read |
| `POST /api/messages` | any | `recipientId` (required), `body` (required, ≤4000), optional `subject` (≤160) and `childId` (any child you may see) → 201 `{ message }` |
| `POST /api/messages/:id/read` | any | stamps `readAt`; sender or recipient only |
| `DELETE /api/messages/:id` | any | removes a message you sent or received |

Message payload: `{ id, threadKey, senderId, senderName, recipientId,
recipientName, childId, subject, body, sentAt, readAt }`. Messages between the
same two people for the same child share one `threadKey`, which is what the
thread endpoint groups on.

## Settings

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /api/settings` | any | `{ settings, schema, canEdit, engine }` — `canEdit` is true for administrators and drives the lock on the settings screen; `schema` is the ordered list of labels the form renders, and the fields that are picked rather than typed also carry `options` (`currency` lists every supported code, `default_due_day` the days 1-28) |
| `PATCH /api/settings` | admin | any subset of the eight keys below, sent as strings → `{ settings, savedAt }` |

The whitelist lives in `src/lib/centre.js`: `school_name` (≤120),
`school_tagline` (≤160), `school_address` (≤200), `school_phone` (≤40),
`school_email` (≤160), `timezone` (≤60), `currency` (one of the codes in
`src/lib/currencies.js`, upper-cased) and `default_due_day` (1-28). Unknown keys
are rejected, a currency outside the list is rejected with the list in the
message, an empty value is ignored (a setting is never cleared) and everything is
stored as text in the `settings` table — which is why the frontend coerces the
values itself (`store.currency()`, `store.defaultDueDay()`, `store.schoolName()`,
…).

The saved currency is the one the rest of the API reports and formats in: the
dashboard's `currency`, the `currency` of `GET /api/invoices/summary`, and the
currency a new invoice gets when the request does not name one. The settings
screen and the picker on the billing screen read the same list
(`GET /api/settings` → `schema.currency.options`), so they cannot drift apart.

## Uploads

| Endpoint | Access | Notes |
| --- | --- | --- |
| `POST /api/uploads` | admin, teacher | `multipart/form-data` with the image in the `file` field (jpg, png, webp or gif, at most `MAX_UPLOAD_MB`) → 201 `{ filename, url, bytes, mimeType, maxBytes }` |
| `DELETE /api/uploads/:filename` | admin, teacher | accepts only names matching `\d{10,}-[0-9a-f]{16}\.(jpg\|png\|webp\|gif)` → `{ deleted: true, filename }` |

Files are served read-only from the `/uploads` prefix
(`config.uploads.publicPrefix`) and
feed posts reference them through `mediaUrl`.

## Health

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /api/health` | public | `{ status: 'ok', engine, database, uptimeSeconds, node }` — `engine` is `sqlite` or `postgres`, and `database` is that adapter's own probe: `{ client: 'sqlite', ok, file }` or `{ client: 'postgres', ok, database }` |

## Worked example

```bash
# sign in once and keep the session cookie
curl -s -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"email":"admin@sproutdesk.test","password":"<seed password>"}' \
  http://localhost:3000/api/auth/login

# bill a child for this month (amount is in currency units, not cents)
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"childId":1,"amount":"120.00","description":"September tuition"}' \
  http://localhost:3000/api/invoices

# record a part payment against it
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"amount":"60.00","method":"bank_transfer"}' \
  http://localhost:3000/api/invoices/1/payments

# read the outstanding balance back for that month
curl -s -b cookies.txt 'http://localhost:3000/api/invoices/summary?period=2026-09'
```



