'use strict';

/**
 * Direct messages: staff and families talk one-to-one.
 * The left column lists conversations, the right column shows the thread.
 */

import { api } from '../api.js';
import * as store from '../state.js';
import * as ui from '../ui.js';

const ROLE_TONES = { admin: 'info', teacher: 'success', parent: 'neutral' };

/** Pick somebody new to write to. */
function newMessageDialog({ contacts, onStarted }) {
  const options = contacts.map((contact) => ({
    value: String(contact.id),
    label: `${contact.fullName} · ${ui.label(contact.role)}`,
  }));

  const element = ui.form(
    [
      ui.field(
        'To',
        ui.select({ name: 'recipientId', options, required: true, placeholder: 'Choose a person' }),
      ),
      ui.field('Subject', ui.input({ name: 'subject', maxlength: 160, placeholder: 'Optional' })),
      ui.field('Message', ui.textarea({ name: 'body', rows: 4, required: true })),
    ],
    {
      submitLabel: 'Send',
      cancel: ui.closeModal,
      onSubmit: async (values) => {
        await api.post('/messages', {
          recipientId: Number(values.recipientId),
          subject: values.subject,
          body: values.body,
        });
        ui.notify.ok('Message sent.');
        ui.closeModal();
        onStarted(Number(values.recipientId));
      },
    },
  );

  ui.openModal({ title: 'New message', body: element });
}

/** One row in the conversation list. */
function threadButton({ thread, active, onOpen }) {
  return ui.el(
    'button',
    {
      class: `thread-button${active ? ' is-active' : ''}`,
      type: 'button',
      onClick: () => onOpen(thread.partnerId),
    },
    ui.el(
      'span',
      {},
      ui.el('strong', { text: thread.partnerName || `User #${thread.partnerId}` }),
      ui.el('br'),
      ui.el('span', { class: 'muted small', text: `${thread.lastMessageFromMe ? 'You: ' : ''}${thread.lastMessagePreview || ''}` }),
    ),
    ui.el(
      'span',
      { class: 'right' },
      thread.unreadCount ? ui.badge(String(thread.unreadCount), 'info') : null,
      ui.el('span', { class: 'muted small', text: ui.fmtRelative(thread.lastMessageAt) }),
    ),
  );
}

/** Message bubbles plus the reply composer. */
function conversationPane({ partner, messages, user, onSent }) {
  const bubbles = ui.el(
    'div',
    { class: 'bubbles' },
    messages.map((message) =>
      ui.el(
        'div',
        { class: `bubble${Number(message.senderId) === Number(user.id) ? ' bubble-mine' : ''}` },
        message.subject ? ui.el('strong', { text: message.subject }) : null,
        message.subject ? ui.el('br') : null,
        ui.el('span', { class: 'post-body', text: message.body }),
        ui.el('time', {
          text: `${ui.fmtDateTime(message.sentAt)}${message.readAt ? ' · read' : ''}`,
          datetime: message.sentAt,
        }),
      ),
    ),
  );

  const bodyInput = ui.textarea({ name: 'body', rows: 2, placeholder: `Write to ${partner.fullName}…`, required: true });
  const childOptions = store.childOptions();
  const childSelect = childOptions.length
    ? ui.select({ name: 'childId', options: childOptions, placeholder: 'Not about a child' })
    : null;

  const send = async () => {
    const text = bodyInput.value.trim();
    if (!text) {
      ui.notify.error('Type a message first.');
      return;
    }
    try {
      await api.post('/messages', {
        recipientId: partner.id,
        body: text,
        childId: childSelect && childSelect.value ? Number(childSelect.value) : undefined,
      });
      bodyInput.value = '';
      if (childSelect) childSelect.value = '';
      await onSent();
    } catch (error) {
      ui.notify.error(error.message);
    }
  };

  const composer = ui.el(
    'div',
    { class: 'composer' },
    childSelect,
    bodyInput,
    ui.button('Send', { onClick: send }),
  );
  bodyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  return ui.card({
    title: partner.fullName,
    subtitle: `${ui.label(partner.role)} · ${partner.email || ''}`,
    actions: [ui.badge(ui.label(partner.role), ROLE_TONES[partner.role] || 'neutral')],
    body: ui.el('div', { class: 'stack' }, bubbles, composer),
  });
}

export default async function renderMessages(container, ctx) {
  const user = ctx.user;
  const requestedId = ctx.query.with ? Number(ctx.query.with) : null;

  await store.loadChildren().catch(() => {});

  let threads = [];
  let contacts = [];
  let openId = requestedId;

  /** Loads the thread for `openId` into the right-hand pane. */
  async function loadConversation(pane, { scroll = true } = {}) {
    if (!openId) {
      ui.mount(pane, ui.emptyState('Choose a conversation.', { hint: 'Or start a new one with the button above.' }));
      return;
    }
    ui.mount(pane, ui.loading('Opening the conversation…'));
    try {
      const { partner, messages } = await api.get(`/messages/thread/${openId}`);
      ui.mount(
        pane,
        conversationPane({
          partner,
          messages,
          user,
          onSent: async () => {
            await refresh();
          },
        }),
      );
      if (scroll) {
        const bubbles = pane.querySelector('.bubbles');
        if (bubbles) bubbles.scrollTop = bubbles.scrollHeight;
      }
      ctx.afterChange?.();
    } catch (error) {
      ui.mount(pane, ui.errorState(error));
    }
  }

  /** Re-reads the conversation list and the open thread. */
  async function refresh() {
    await draw({ keepPane: true });
  }

  async function draw({ keepPane = false } = {}) {
    if (!keepPane) ui.mount(container, ui.loading('Loading your messages…'));
    try {
      threads = await api.get('/messages');
      contacts = await api.get('/messages/contacts');

      if (!openId && threads.length) openId = threads[0].partnerId;

      const listBox = ui.el(
        'div',
        { class: 'thread-list' },
        threads.length
          ? threads.map((thread) =>
              threadButton({
                thread,
                active: Number(thread.partnerId) === Number(openId),
                onOpen: (partnerId) => {
                  openId = partnerId;
                  ctx.go('/messages', { with: partnerId });
                },
              }),
            )
          : ui.emptyState('No conversations yet.'),
      );

      const pane = ui.el('div', { class: 'stack' });
      ui.mount(
        container,
        ui.el(
          'div',
          { class: 'stack' },
          ui.el(
            'div',
            { class: 'stats' },
            ui.stat(threads.length, 'conversations', { tone: 'info' }),
            ui.stat(
              threads.reduce((total, thread) => total + Number(thread.unreadCount || 0), 0),
              'unread messages',
              { tone: 'warn' },
            ),
            ui.stat(contacts.length, 'people you can write to'),
          ),
          ui.el(
            'div',
            { class: 'grid grid-2' },
            ui.card({
              title: 'Conversations',
              subtitle: 'Staff and families of the centre',
              actions: [
                ui.button('New', {
                  kind: 'ghost',
                  onClick: () =>
                    newMessageDialog({
                      contacts,
                      onStarted: (partnerId) => {
                        openId = partnerId;
                        ctx.go('/messages', { with: partnerId });
                      },
                    }),
                }),
              ],
              body: listBox,
            }),
            pane,
          ),
        ),
      );

      await loadConversation(pane);
    } catch (error) {
      ui.mount(container, ui.errorState(error));
    }
  }

  await draw();
}
