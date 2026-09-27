'use strict';

/** Sign-in screen. Also offers the accounts created by `npm run seed`. */

import { api } from '../api.js';
import * as ui from '../ui.js';

const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'admin@sproutdesk.test', password: 'Admin123!' },
  { label: 'Teacher · Mia', email: 'mia.tanaka@sproutdesk.test', password: 'Teacher123!' },
  { label: 'Teacher · Lucas', email: 'lucas.moreau@sproutdesk.test', password: 'Teacher123!' },
  { label: 'Parent · Elena', email: 'elena.petrescu@sproutdesk.test', password: 'Parent123!' },
  { label: 'Parent · Samuel', email: 'samuel.okafor@sproutdesk.test', password: 'Parent123!' },
];

export function renderLogin(container, { message = '', onSignedIn }) {
  const email = ui.input({
    name: 'email',
    type: 'email',
    placeholder: 'you@example.com',
    required: true,
    autocomplete: 'username',
  });
  const password = ui.input({
    name: 'password',
    type: 'password',
    placeholder: 'Your password',
    required: true,
    autocomplete: 'current-password',
  });
  const errorBox = ui.el('div', { class: 'alert alert-error', hidden: true });
  const engineNote = ui.el('p', { class: 'muted small', text: 'Connecting…' });
  const submitButton = ui.button('Sign in', { type: 'submit' });

  const form = ui.el(
    'form',
    { class: 'form' },
    ui.el(
      'div',
      { class: 'form-grid' },
      ui.field('Email address', email),
      ui.field('Password', password),
    ),
    errorBox,
    ui.el('div', { class: 'form-actions' }, submitButton),
  );

  function showError(text) {
    errorBox.textContent = text;
    errorBox.hidden = !text;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    submitButton.disabled = true;
    submitButton.textContent = 'Signing in…';
    try {
      const payload = await api.post('/auth/login', {
        email: email.value.trim(),
        password: password.value,
      });
      await onSignedIn(payload);
    } catch (error) {
      showError(error.message);
      password.value = '';
      password.focus();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Sign in';
    }
  });

  const demoList = ui.el(
    'ul',
    {},
    DEMO_ACCOUNTS.map((account) =>
      ui.el(
        'li',
        {},
        ui.el('button', {
          type: 'button',
          text: `${account.label} — ${account.email}`,
          onClick: () => {
            email.value = account.email;
            password.value = account.password;
            form.requestSubmit();
          },
        }),
      ),
    ),
  );

  ui.mount(
    container,
    ui.el(
      'div',
      { class: 'login-card' },
      ui.el('span', { class: 'brand-mark', text: 'SD' }),
      ui.el('h1', { text: 'SproutDesk' }),
      ui.el('p', {
        class: 'muted',
        text: 'Early learning centre management — attendance, daily reports, family messaging and billing in one place.',
      }),
      message ? ui.el('div', { class: 'alert alert-info', text: message }) : null,
      form,
      ui.el(
        'div',
        { class: 'demo-accounts' },
        ui.el('p', {
          class: 'muted small',
          text: 'Accounts created by the seed script (change these passwords before going live):',
        }),
        demoList,
      ),
      engineNote,
    ),
  );

  api
    .get('/health')
    .then((health) => {
      engineNote.textContent = `Connected · ${health.engine} database · Node ${health.node}`;
    })
    .catch(() => {
      engineNote.textContent = 'The SproutDesk server is not responding yet.';
    });

  email.focus();
}

export default renderLogin;
