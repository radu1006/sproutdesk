'use strict';

/**
 * SproutDesk single-page application shell.
 *
 * Responsibilities, in order of execution:
 *   1. ask `/api/auth/me` who is signed in (or show the sign-in screen),
 *   2. build the role-aware navigation from the route table below,
 *   3. render the view for the current hash route into `#view`,
 *   4. keep the unread badges and the top-bar actions in sync.
 */

import { api } from './api.js';
import * as store from './state.js';
import * as ui from './ui.js';
import { matchRoute, onRouteChange, parseHash, replace, startRouter } from './router.js';
import { navigate } from './router.js';
import { renderLogin } from './views/login.js';
import renderDashboard from './views/dashboard.js';
import renderAttendance from './views/attendance.js';
import renderReports from './views/reports.js';
import renderObservations from './views/observations.js';
import renderChildren from './views/children.js';
import renderClassrooms from './views/classrooms.js';
import renderUsers from './views/users.js';
import renderFeed from './views/feed.js';
import renderAnnouncements from './views/announcements.js';
import renderEvents from './views/events.js';
import renderMessages from './views/messages.js';
import renderBilling from './views/billing.js';
import renderSettings from './views/settings.js';

const ALL = ['admin', 'teacher', 'parent'];
const STAFF = ['admin', 'teacher'];

/** The single source of truth for the sidebar *and* the router. */
const ROUTES = [
  {
    path: '/dashboard',
    nav: 'Overview',
    label: 'Dashboard',
    title: 'Dashboard',
    subtitle: () => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    roles: ALL,
    render: renderDashboard,
  },
  {
    path: '/attendance',
    nav: 'Daily care',
    label: 'Attendance',
    title: 'Attendance',
    roles: ALL,
    render: renderAttendance,
  },
  {
    path: '/reports',
    nav: 'Daily care',
    label: 'Daily reports',
    title: 'Daily reports',
    roles: ALL,
    render: renderReports,
  },
  {
    path: '/observations',
    nav: 'Daily care',
    label: 'Observations',
    title: 'Observations',
    roles: ALL,
    render: renderObservations,
  },
  {
    path: '/children',
    nav: 'People',
    label: 'Children',
    title: 'Children',
    roles: ALL,
    render: renderChildren,
  },
  {
    path: '/classrooms',
    nav: 'People',
    label: 'Classrooms',
    title: 'Classrooms',
    roles: STAFF,
    render: renderClassrooms,
  },
  {
    path: '/people',
    nav: 'People',
    label: 'Staff & families',
    title: 'Staff & families',
    roles: ['admin'],
    render: renderUsers,
  },
  {
    path: '/feed',
    nav: 'Community',
    label: 'Class feed',
    title: 'Class feed',
    roles: ALL,
    render: renderFeed,
  },
  {
    path: '/announcements',
    nav: 'Community',
    label: 'Announcements',
    title: 'Announcements',
    roles: ALL,
    badge: 'announcements',
    render: renderAnnouncements,
  },
  {
    path: '/events',
    nav: 'Community',
    label: 'Calendar',
    title: 'Calendar',
    roles: ALL,
    render: renderEvents,
  },
  {
    path: '/messages',
    nav: 'Community',
    label: 'Messages',
    title: 'Messages',
    roles: ALL,
    badge: 'messages',
    render: renderMessages,
  },
  {
    path: '/billing',
    nav: 'Office',
    label: 'Billing',
    title: 'Billing',
    roles: ['admin', 'parent'],
    render: renderBilling,
  },
  {
    path: '/settings',
    nav: 'Office',
    label: 'Settings',
    title: 'Settings',
    roles: ALL,
    render: renderSettings,
  },
];

const dom = {
  boot: document.getElementById('boot'),
  login: document.getElementById('login-screen'),
  shell: document.getElementById('shell'),
  nav: document.getElementById('nav'),
  view: document.getElementById('view'),
  title: document.getElementById('page-title'),
  subtitle: document.getElementById('page-subtitle'),
  actions: document.getElementById('topbar-actions'),
  brandName: document.getElementById('brand-name'),
  brandTagline: document.getElementById('brand-tagline'),
  engineNote: document.getElementById('engine-note'),
  menuToggle: document.getElementById('menu-toggle'),
};

/* ------------------------------------------------------------------- chrome */

/** Views may publish their own top-bar buttons; only theirs are replaced. */
function setViewActions(...nodes) {
  for (const node of dom.actions.querySelectorAll('[data-view-action]')) node.remove();
  const flat = nodes.flat().filter(Boolean);
  if (!flat.length) return;
  dom.actions.prepend(ui.el('div', { class: 'row', dataset: { viewAction: '1' } }, flat));
}

function renderChrome() {
  dom.brandName.textContent = store.schoolName();
  dom.brandTagline.textContent = store.schoolTagline() || 'Early learning centre';
  dom.engineNote.textContent = `Signed in as ${store.getUser().email}`;
}

function renderUserBlock() {
  for (const node of dom.actions.querySelectorAll('[data-user-block]')) node.remove();
  const user = store.getUser();
  dom.actions.append(
    ui.el(
      'div',
      { class: 'row', dataset: { userBlock: '1' } },
      ui.el(
        'div',
        { class: 'who' },
        ui.el('strong', { text: user.fullName }),
        ui.el('span', { class: 'muted small', text: ui.label(user.role) }),
      ),
      ui.button('Sign out', { kind: 'ghost', onClick: signOut }),
    ),
  );
}

function renderNav() {
  const role = store.getUser().role;
  const groups = new Map();
  for (const route of ROUTES) {
    if (!route.nav || !route.roles.includes(role)) continue;
    if (!groups.has(route.nav)) groups.set(route.nav, []);
    groups.get(route.nav).push(route);
  }

  const nodes = [];
  for (const [group, routes] of groups) {
    nodes.push(ui.el('p', { class: 'nav-group', text: group }));
    for (const route of routes) {
      nodes.push(
        ui.el(
          'button',
          {
            class: 'nav-link',
            type: 'button',
            dataset: { path: route.path },
            onClick: () => {
              closeNav();
              navigate(route.path);
            },
          },
          ui.el('span', { text: route.label }),
          route.badge
            ? ui.el('span', { class: 'nav-count', hidden: true, dataset: { badge: route.badge } })
            : null,
        ),
      );
    }
  }
  ui.mount(dom.nav, nodes);
}

function highlightNav(path) {
  for (const link of dom.nav.querySelectorAll('.nav-link')) {
    link.classList.toggle('is-active', link.dataset.path === path);
  }
}

function closeNav() {
  dom.shell.classList.remove('nav-open');
}

async function refreshBadges() {
  try {
    const [messages, announcements] = await Promise.all([
      api.get('/messages/unread'),
      api.get('/announcements', { unreadOnly: true }),
    ]);
    const counts = {
      messages: Number(messages?.unread || 0),
      announcements: Array.isArray(announcements) ? announcements.length : 0,
    };
    store.setUnread(counts);
    for (const node of dom.nav.querySelectorAll('[data-badge]')) {
      const value = counts[node.dataset.badge] || 0;
      node.textContent = value ? String(value) : '';
      node.hidden = value === 0;
    }
  } catch {
    /* Badges are decorative: never block the page on them. */
  }
}

/* -------------------------------------------------------------------- router */

let started = false;

async function handleRoute() {
  const user = store.getUser();
  if (!user) return;

  closeNav();
  const { path, query } = parseHash();
  const match = matchRoute(ROUTES, path);
  if (!match) {
    replace('/dashboard');
    return;
  }

  const { route, params } = match;
  if (!route.roles.includes(user.role)) {
    dom.title.textContent = route.title;
    ui.mount(dom.view, ui.errorState(new Error(`Your ${user.role} account cannot open ${route.label}.`)));
    return;
  }

  dom.title.textContent = route.title;
  dom.subtitle.textContent =
    typeof route.subtitle === 'function' ? route.subtitle({ query, params }) : route.subtitle || '';
  setViewActions();
  highlightNav(path);
  ui.mount(dom.view, ui.loading(`Loading ${route.label.toLowerCase()}…`));

  try {
    await route.render(dom.view, {
      params,
      query,
      user,
      setActions: setViewActions,
      go: navigate,
      afterChange: refreshBadges,
    });
  } catch (error) {
    ui.mount(dom.view, ui.errorState(error));
  }
}

/* ------------------------------------------------------------------- session */

async function startSession(payload) {
  store.setUser(payload.user);
  if (payload.school) store.setSettings(payload.school);

  dom.boot.hidden = true;
  dom.login.hidden = true;
  ui.clear(dom.login);
  dom.shell.hidden = false;

  renderChrome();
  renderNav();
  renderUserBlock();
  highlightNav(parseHash().path);
  await refreshBadges();

  if (started) handleRoute();
  else {
    started = true;
    onRouteChange(handleRoute);
    startRouter();
  }
}

function showLogin(message = '') {
  store.setUser(null);
  ui.closeModal();
  dom.shell.hidden = true;
  dom.boot.hidden = true;
  dom.login.hidden = false;
  renderLogin(dom.login, { message, onSignedIn: startSession });
}

async function signOut() {
  try {
    await api.post('/auth/logout');
  } catch {
    /* Signing out locally is enough if the session already expired. */
  }
  showLogin('You have been signed out.');
}

/* ---------------------------------------------------------------------- boot */

function wireChrome() {
  dom.menuToggle.addEventListener('click', () => dom.shell.classList.toggle('nav-open'));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ui.modalOpen()) ui.closeModal();
  });
  // The brand line reads straight from the store, so saving in Settings
  // refreshes the header without a reload.
  store.subscribe(() => {
    if (store.getUser()) renderChrome();
  });
}

async function boot() {
  wireChrome();
  window.addEventListener('sprout:unauthorized', () => {
    if (store.getUser()) showLogin('Your session has ended. Please sign in again.');
  });

  try {
    const payload = await api.get('/auth/me');
    await startSession(payload);
  } catch (error) {
    showLogin(
      error?.status === 401
        ? ''
        : 'The SproutDesk server could not be reached. Start it and reload this page.',
    );
  }
}

boot();

