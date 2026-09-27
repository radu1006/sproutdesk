# Database

SproutDesk runs **one** set of SQL statements against either engine:

| | SQLite (default) | PostgreSQL |
| --- | --- | --- |
| Driver | `better-sqlite3` (synchronous, wrapped in promises) | `pg` (connection pool) |
| Schema file | `src/db/schema.sqlite.sql` | `src/db/schema.postgres.sql` |
| Placeholders | `?` | `?` in the source, translated to `$1, $2 …` by `src/db/postgres.js` |
| Selected by | `DATABASE_CLIENT=sqlite` | `DATABASE_CLIENT=postgres` |

Both files contain the same 16 tables with the same column names, data
conventions and indexes. The only differences are the primary-key syntax
(`INTEGER PRIMARY KEY AUTOINCREMENT` vs `INTEGER GENERATED ALWAYS AS IDENTITY
PRIMARY KEY`) and `CASCADE` on drops.

## Conventions

| Kind | Storage | Example |
| --- | --- | --- |
| Timestamp | `TEXT`, ISO-8601 UTC | `2026-09-26T08:15:00.000Z` |
| Date | `TEXT`, `YYYY-MM-DD` | `2026-09-26` |
| Time | `TEXT`, `HH:MM` | `08:15` |
| Boolean | `INTEGER` `0`/`1` | `all_day = 1` |
| Money | `INTEGER` **cents** | `12500` = USD 125.00 |
| Enumeration | `TEXT` + `CHECK` | `status IN ('unpaid','partial','paid','void')` |

Dates are compared as strings (`due_date < today`), which is correct because the
format is fixed width and zero padded — and it behaves identically on both
engines.

## Tables

### users
Staff and family accounts: `id`, `email` (unique), `password_hash` (bcrypt),
`full_name`, `role` (`admin` | `teacher` | `parent`), `phone`, `job_title`,
`is_active`, `last_login_at`, `created_at`, `updated_at`.

### classrooms
`id`, `name` (unique), `age_group`, `capacity`, `room_label`,
`lead_teacher_id → users(id) ON DELETE SET NULL`, `notes`, timestamps.

### children
`id`, `first_name`, `last_name`, `date_of_birth`, `classroom_id → classrooms`,
`enrollment_status` (`active` | `waitlist` | `archived`), `start_date`,
`allergies`, `medical_notes`, `photo_url`, timestamps.

### guardians
Links a parent account to a child: `child_id → children ON DELETE CASCADE`,
`user_id → users ON DELETE CASCADE`, `relationship` (`mother` | `father` |
`guardian` | `other`), `is_primary_contact`, `created_at`,
`UNIQUE (child_id, user_id)`. This is the table `src/lib/access.js` uses to
decide which children a parent may see.

### attendance
One row per child per day: `child_id`, `attendance_date`, `status` (`present` |
`absent` | `late` | `sick` | `holiday`), `check_in_time`, `check_out_time`,
`note`, `recorded_by → users`, timestamps, `UNIQUE (child_id, attendance_date)`.

### daily_reports
`child_id`, `report_date`, `mood` (`happy` | `calm` | `tired` | `upset` |
`energetic`), `breakfast`/`lunch`/`snack` (`all` | `most` | `some` | `none`),
`nap_minutes`, `toilet_notes`, `activities`, `teacher_note`, `created_by`,
timestamps, `UNIQUE (child_id, report_date)`.

### observations
`child_id`, `area` (`language` | `motor` | `social` | `cognitive` | `creative` |
`self_care`), `level` (`emerging` | `developing` | `secure`), `note`,
`observed_on`, `created_by`, timestamps.

### class_posts
`classroom_id`, `author_id`, `title`, `body`, `media_url`, `media_type`
(`none` | `image` | `video`), `posted_at`, timestamps.

### announcements
`title`, `body`, `audience` (`all` | `teachers` | `parents`), `classroom_id`,
`author_id`, `published_at`, `expires_on`, timestamps.

### announcement_reads
`announcement_id → announcements ON DELETE CASCADE`, `user_id → users ON DELETE
CASCADE`, `read_at`, `UNIQUE (announcement_id, user_id)`. Drives the unread
badge in the sidebar.

### events
`title`, `description`, `location`, `starts_at`, `ends_at`, `all_day`,
`audience`, `classroom_id`, `created_by`, timestamps.

### invoices
`child_id`, `number` (unique, `SD-YYYYMM-0001`), `period_label` (`YYYY-MM`),
`description`, `amount_cents`, `currency`, `due_date`, `issued_on`, `status`
(`unpaid` | `partial` | `paid` | `void`), `created_by`, timestamps.
See `src/routes/invoices.js`.

### payments
`invoice_id → invoices ON DELETE CASCADE`, `amount_cents`, `paid_on`, `method`
(`cash` | `bank_transfer` | `card` | `other`), `reference`,
`recorded_by → users`, `created_at`. The invoice status is recalculated from
`SUM(payments.amount_cents)` after every payment change.

### messages
`thread_key` (the two user ids, ordered), `sender_id`, `recipient_id`,
`child_id`, `subject`, `body`, `sent_at`, `read_at`, `created_at`.

### sessions
Server-side sessions: `id` (random token, primary key), `user_id → users ON
DELETE CASCADE`, `created_at`, `expires_at`, `user_agent`, `ip_address`.
Expired rows are purged at sign-in and hourly (`src/lib/sessions.js`).

### settings
Key/value strings, `key` is the primary key. The API only exposes the eight keys
whitelisted in `src/routes/settings.js`: `school_name`, `school_tagline`,
`school_address`, `school_phone`, `school_email`, `timezone`, `currency`,
`default_due_day`. Every value is stored as a string.

## Indexes

`users(role)` · `children(classroom_id)` · `guardians(user_id)`,
`guardians(child_id)` · `attendance(attendance_date)`,
`attendance(child_id, attendance_date)` · `daily_reports(report_date)`,
`daily_reports(child_id, report_date)` · `observations(child_id, observed_on)` ·
`class_posts(classroom_id, posted_at)` · `announcements(published_at, audience)` ·
`events(starts_at)` · `invoices(child_id, issued_on)` · `payments(invoice_id)` ·
`messages(thread_key, sent_at)`, `messages(recipient_id, read_at)` ·
`sessions(user_id)`, `sessions(expires_at)`.

## Migrations

`npm run migrate` (`src/db/migrate.js`):

1. applies the schema file for the selected engine — every statement is
   `IF NOT EXISTS`, so the file can be replayed safely;
2. inserts the eight default settings with `ON CONFLICT (key) DO NOTHING`, so a
   value someone already saved is never overwritten;
3. prints the row count of every table.

`npm run reset` adds `--fresh`, which drops the 16 tables in dependency order
(child tables first, `CASCADE` on PostgreSQL) and re-applies the schema.
**`--fresh` destroys all data.**

There is no versioned migration history: the schema file is the source of truth
and new columns are added by editing both dialects. That keeps the project
dependency free; on an existing database it means a manual `ALTER TABLE`.

## Seeding

`npm run seed` (`src/db/seed.js`) inserts a complete demo centre: staff and
family accounts, four classrooms, children with guardians, a fortnight of
attendance and daily reports, observations, feed posts, announcements, events,
threaded messages, and a few months of invoices with partial payments. It is
idempotent per email / child / period, so re-running it does not duplicate rows.
The account list it prints is also in the [README](../README.md#demo-accounts-after-npm-run-seed).

## Common queries

Outstanding balance per period (used by `GET /api/invoices/summary`):

```sql
SELECT i.period_label, SUM(i.amount_cents) AS billed_cents,
       COALESCE(SUM(p.paid_cents), 0) AS paid_cents
  FROM invoices i
  LEFT JOIN (SELECT invoice_id, SUM(amount_cents) AS paid_cents
               FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id
 WHERE i.period_label = ?
   AND i.status <> 'void'
 GROUP BY i.period_label
```

The children a user may see (`src/lib/access.js`): admins get no restriction,
teachers get the children in the classrooms they lead, parents get the rows in
`guardians` that point at their account.

## SQLite notes

* the file (default `./data/sproutdesk.sqlite`) and its directory are created on
  first use;
* `journal_mode = WAL`, `foreign_keys = ON` and `busy_timeout = 5000` are set on
  connect (`src/db/sqlite.js`);
* back up by copying the `.sqlite`, `.sqlite-wal` and `.sqlite-shm` files while
  the server is stopped.

## PostgreSQL notes

```bash
createdb sproutdesk
createuser sproutdesk --pwprompt
psql -d sproutdesk -c 'GRANT ALL ON DATABASE sproutdesk TO sproutdesk'
```

Set `DATABASE_CLIENT=postgres` and either `DATABASE_URL` or `PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, `PGPASSWORD` (plus `PGSSL=true` when the provider needs
TLS) in `.env`, then run `npm run migrate`.

Driver errors are translated centrally (`src/middleware/error.js`): a unique
violation becomes `409 conflict`, a `CHECK`/`NOT NULL` violation becomes
`400 invalid_value`, a foreign-key violation becomes `409 conflict`.

## Transactions

`db.tx(fn)` runs the callback inside `BEGIN … COMMIT` on both engines. On
PostgreSQL the dedicated client is carried through `AsyncLocalStorage`, so
nested `db.*` calls automatically join the same transaction. Nested `tx()` calls
are not supported.
