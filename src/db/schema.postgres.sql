-- ===========================================================================
-- SproutDesk database schema - PostgreSQL dialect
-- ===========================================================================
-- Same tables, same column names and the same data conventions as
-- src/db/schema.sqlite.sql, so the application code is engine independent.
-- The only differences are the primary-key syntax and the index syntax.
-- Run it with:  npm run migrate        (after setting DATABASE_CLIENT=postgres)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  full_name     TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('admin', 'teacher', 'parent')),
  phone         TEXT,
  job_title     TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_login_at TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS classrooms (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            TEXT    NOT NULL UNIQUE,
  age_group       TEXT,
  capacity        INTEGER NOT NULL DEFAULT 20,
  room_label      TEXT,
  lead_teacher_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS children (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_name        TEXT    NOT NULL,
  last_name         TEXT    NOT NULL,
  date_of_birth     TEXT    NOT NULL,
  classroom_id      INTEGER REFERENCES classrooms (id) ON DELETE SET NULL,
  enrollment_status TEXT    NOT NULL DEFAULT 'active'
                            CHECK (enrollment_status IN ('active', 'waitlist', 'archived')),
  start_date        TEXT,
  allergies         TEXT,
  medical_notes     TEXT,
  photo_url         TEXT,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS guardians (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  child_id           INTEGER NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  user_id            INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  relationship       TEXT    NOT NULL DEFAULT 'guardian'
                             CHECK (relationship IN ('mother', 'father', 'guardian', 'other')),
  is_primary_contact INTEGER NOT NULL DEFAULT 0 CHECK (is_primary_contact IN (0, 1)),
  created_at         TEXT    NOT NULL,
  UNIQUE (child_id, user_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  child_id        INTEGER NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  attendance_date TEXT    NOT NULL,
  status          TEXT    NOT NULL
                          CHECK (status IN ('present', 'absent', 'late', 'sick', 'holiday')),
  check_in_time   TEXT,
  check_out_time  TEXT,
  note            TEXT,
  recorded_by     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  UNIQUE (child_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  child_id     INTEGER NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  report_date  TEXT    NOT NULL,
  mood         TEXT CHECK (mood IS NULL OR mood IN ('happy', 'calm', 'tired', 'upset', 'energetic')),
  breakfast    TEXT CHECK (breakfast IS NULL OR breakfast IN ('all', 'most', 'some', 'none')),
  lunch        TEXT CHECK (lunch IS NULL OR lunch IN ('all', 'most', 'some', 'none')),
  snack        TEXT CHECK (snack IS NULL OR snack IN ('all', 'most', 'some', 'none')),
  nap_minutes  INTEGER,
  toilet_notes TEXT,
  activities   TEXT,
  teacher_note TEXT,
  created_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  UNIQUE (child_id, report_date)
);

CREATE TABLE IF NOT EXISTS observations (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  child_id    INTEGER NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  area        TEXT    NOT NULL
                      CHECK (area IN ('language', 'motor', 'social', 'cognitive', 'creative', 'self_care')),
  level       TEXT    NOT NULL CHECK (level IN ('emerging', 'developing', 'secure')),
  note        TEXT,
  observed_on TEXT    NOT NULL,
  created_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS class_posts (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  classroom_id INTEGER NOT NULL REFERENCES classrooms (id) ON DELETE CASCADE,
  author_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  title        TEXT,
  body         TEXT,
  media_url    TEXT,
  media_type   TEXT NOT NULL DEFAULT 'none'
                    CHECK (media_type IN ('none', 'image', 'video')),
  posted_at    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title        TEXT    NOT NULL,
  body         TEXT    NOT NULL,
  audience     TEXT    NOT NULL DEFAULT 'all'
                       CHECK (audience IN ('all', 'teachers', 'parents')),
  classroom_id INTEGER REFERENCES classrooms (id) ON DELETE CASCADE,
  author_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  published_at TEXT    NOT NULL,
  expires_on   TEXT,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS announcement_reads (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  announcement_id INTEGER NOT NULL REFERENCES announcements (id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  read_at         TEXT    NOT NULL,
  UNIQUE (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title        TEXT    NOT NULL,
  description  TEXT,
  location     TEXT,
  starts_at    TEXT    NOT NULL,
  ends_at      TEXT,
  all_day      INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  audience     TEXT    NOT NULL DEFAULT 'all'
                       CHECK (audience IN ('all', 'teachers', 'parents')),
  classroom_id INTEGER REFERENCES classrooms (id) ON DELETE CASCADE,
  created_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  child_id     INTEGER NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  number       TEXT    NOT NULL UNIQUE,
  period_label TEXT    NOT NULL,
  description  TEXT,
  amount_cents INTEGER NOT NULL,
  currency     TEXT    NOT NULL DEFAULT 'USD',
  due_date     TEXT    NOT NULL,
  issued_on    TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'unpaid'
                       CHECK (status IN ('unpaid', 'partial', 'paid', 'void')),
  created_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id   INTEGER NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  paid_on      TEXT    NOT NULL,
  method       TEXT    NOT NULL DEFAULT 'bank_transfer'
                       CHECK (method IN ('cash', 'bank_transfer', 'card', 'other')),
  reference    TEXT,
  recorded_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_key   TEXT    NOT NULL,
  sender_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  child_id     INTEGER REFERENCES children (id) ON DELETE SET NULL,
  subject      TEXT,
  body         TEXT    NOT NULL,
  sent_at      TEXT    NOT NULL,
  read_at      TEXT,
  created_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  user_agent TEXT,
  ip_address TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes --------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_role          ON users (role);
CREATE INDEX IF NOT EXISTS idx_children_classroom  ON children (classroom_id);
CREATE INDEX IF NOT EXISTS idx_guardians_user      ON guardians (user_id);
CREATE INDEX IF NOT EXISTS idx_guardians_child     ON guardians (child_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date     ON attendance (attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_child    ON attendance (child_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_date  ON daily_reports (report_date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_child ON daily_reports (child_id, report_date);
CREATE INDEX IF NOT EXISTS idx_observations_child  ON observations (child_id, observed_on);
CREATE INDEX IF NOT EXISTS idx_posts_classroom     ON class_posts (classroom_id, posted_at);
CREATE INDEX IF NOT EXISTS idx_announcements_pub   ON announcements (published_at, audience);
CREATE INDEX IF NOT EXISTS idx_events_starts       ON events (starts_at);
CREATE INDEX IF NOT EXISTS idx_invoices_child      ON invoices (child_id, issued_on);
CREATE INDEX IF NOT EXISTS idx_payments_invoice    ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread     ON messages (thread_key, sent_at);
CREATE INDEX IF NOT EXISTS idx_messages_recipient  ON messages (recipient_id, read_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user       ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires    ON sessions (expires_at);