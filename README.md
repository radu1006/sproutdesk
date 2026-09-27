# SproutDesk

SproutDesk is an early-learning centre management platform: attendance, daily
reports, observations, class feed, announcements, events, family messaging and
billing, wrapped in one small web application.

Everything in this repository is original code written for this project — see
[NOTICE](NOTICE).

## Highlights

| Area | What you get |
| --- | --- |
| Attendance | One row per child per day, check-in/check-out times, bulk "mark the room" screen, daily summary |
| Daily reports | Mood, meals, nap, activities and teacher notes per child per day |
| Observations | Learning-area observations with an emerging/developing/secure level and per-child progress |
| Class feed | Photo posts per classroom, using the built-in upload endpoint |
| Announcements | Audience-aware notices with per-user read tracking |
| Calendar | Centre events, filters and an upcoming list |
| Messages | Threaded parent ↔ staff conversations |
| Children & people | Children, guardians, classrooms and staff accounts |
| Billing | Monthly invoice per child, payments, live status (unpaid/partial/paid/void) and an outstanding-balance summary |
| Settings | Centre identity, contact details, currency and invoice due day |

## Roles

* **admin** – the whole centre, and the only role that can manage people,
  classrooms, billing and settings.
* **teacher** – the classrooms they lead: roster, attendance, reports,
  observations, feed, announcements, events and messages.
* **parent** – read-only, limited to their own children: attendance, reports,
  observations, feed, announcements, events, messages and their own invoices.

Visibility is enforced on the server (`src/lib/access.js`), not in the browser.

## Stack

* Node.js >= 20.10 — no build step, no bundler, no frontend dependencies
* Express 4, cookie sessions (`src/lib/sessions.js`), `bcryptjs` password hashes
* SQLite by default (`better-sqlite3`) or PostgreSQL (`pg`) — one SQL dialect,
  chosen with `DATABASE_CLIENT`
* Front end: hand-written ES modules served from `public/`

## Quick start

```bash
npm install
copy .env.example .env     # macOS/Linux: cp .env.example .env
npm run migrate            # create the schema + default settings
npm run seed               # optional: a demo centre with a term of data
npm start                  # http://localhost:3000
```

## Demo accounts (after `npm run seed`)

| Role | Email | Password |
| --- | --- | --- |
| admin | `admin@sproutdesk.test` | `Admin123!` |
| teacher | `mia.tanaka@sproutdesk.test` | `Teacher123!` |
| teacher | `lucas.moreau@sproutdesk.test` | `Teacher123!` |
| parent | `elena.petrescu@sproutdesk.test` | `Parent123!` |
| parent | `samuel.okafor@sproutdesk.test` | `Parent123!` |

Change these passwords (or delete the accounts) before going live.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Start the server |
| `npm run dev` | Start with `node --watch` |
| `npm run migrate` | Create missing tables/indexes and default settings |
| `npm run reset` | `--fresh` migration (drops every table) followed by the seed |
| `npm run seed` | Insert the demo centre |
| `npm test` | Run the test suite (`node --test` finds `tests/*.test.js`) |

## Configuration

Everything is configured through `.env` (copy `.env.example`). The ones you
will actually touch:

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | |
| `NODE_ENV` | `development` | `production` enables `trust proxy` |
| `SESSION_SECRET` | dev fallback | use a long random value in production |
| `SESSION_TTL_HOURS` | `12` | |
| `DATABASE_CLIENT` | `sqlite` | `sqlite` or `postgres` |
| `SQLITE_PATH` | `./data/sproutdesk.sqlite` | SQLite only |
| `DATABASE_URL` / `PGHOST` … | `localhost:5432/sproutdesk` | PostgreSQL only |
| `UPLOAD_DIR` / `MAX_UPLOAD_MB` | `./uploads` / `5` | class feed images |
| `DEFAULT_CURRENCY` | `USD` | currency before the centre picks its own on the Settings screen |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | `admin@sproutdesk.test` | used by `npm run seed` only |

## Project layout

```
server.js               HTTP server, static hosting, SPA fallback
src/
  config.js             environment configuration
  db/                   schema (sqlite + postgres), drivers, migration, seed
  lib/                  validate, serialize, access, dates, sessions, errors
  middleware/           auth (attachUser / requireAuth / requireRole) and errors
  routes/               one module per API area, mounted under /api
public/
  index.html            application shell
  styles.css            all styling
  js/                   SPA: app.js, router, state, ui and views/*
docs/DATABASE.md        schema, indexes and engine notes
docs/API.md             endpoint reference
tests/                  node:test suite
```

## Data conventions

* money is stored and transported as **integer cents**; `ui.fmtMoney` renders it
* calendar dates are `YYYY-MM-DD`, timestamps are ISO-8601 UTC strings
* booleans are `0`/`1` in both engines and real booleans in JSON
* enumerations are `TEXT` columns with `CHECK` constraints
* every query is parameterised and column names are whitelisted per route

## Documentation

* [docs/API.md](docs/API.md) — every endpoint, who may call it and its payload
* [docs/DATABASE.md](docs/DATABASE.md) — tables, indexes and switching engines

## License

MIT — see [LICENSE](LICENSE).
