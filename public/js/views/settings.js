'use strict';

/**
 * Centre settings. Everyone can read the values the API exposes (name, contact
 * details, currency, invoice due day); only an administrator can change them.
 *
 * Every value is stored as a string in the `settings` table, so the form always
 * sends strings back and the API takes care of trimming / validating them. The
 * fields that are picked from a list (currency, invoice due day) get their
 * options from the API schema, so the picker can never offer a value the server
 * would reject.
 */

import { api } from '../api.js';
import * as store from '../state.js';
import * as ui from '../ui.js';

/** Form hints that are not part of the API schema. */
const HINTS = {
  school_name: 'Shown in the sidebar and on printed invoices.',
  school_tagline: 'A short line under the centre name.',
  school_address: 'Street address used in letters to families.',
  school_phone: 'Number families should call, including country code.',
  school_email: 'Where families can reach the office.',
  timezone: 'IANA name, for example Europe/Berlin.',
  currency: 'Every new invoice is raised in this currency and amounts are shown in it.',
  default_due_day: 'Day of the month invoices are due on (1-28).',
};

const PLACEHOLDERS = {
  school_name: 'Sunny Hill Early Learning',
  school_tagline: 'Growing curious minds together',
  school_address: '12 Meadow Lane',
  school_phone: '+1 555 0134',
  school_email: 'office@sunnyhill.example',
  timezone: 'UTC',
  currency: 'USD',
  default_due_day: '10',
};

/** The settings table only holds values someone has actually saved. */
const isBlank = (value) => value === null || value === undefined || value === '';

/**
 * The API sends the choices for the fields that are picked from a list
 * (currency, invoice due day). A value that is not on the list any more stays
 * visible and stays selected, instead of silently becoming the first choice.
 */
function optionsFor(field, value) {
  const options = Array.isArray(field.options) ? field.options.slice() : [];
  const current = isBlank(value) ? '' : String(value);
  if (current && !options.some((option) => String(option.value) === current)) {
    options.unshift({ value: current, label: `${current} (current)` });
  }
  return options;
}

/** One control per setting, driven by the schema the API sends back. */
function controlFor(field, value, canEdit) {
  const options = optionsFor(field, value);
  if (options.length) {
    return ui.select({
      name: field.key,
      value: isBlank(value) ? '' : String(value),
      options,
      placeholder: isBlank(value) ? 'Not set' : undefined,
      disabled: !canEdit,
    });
  }
  return ui.input({
    name: field.key,
    type: field.key === 'school_email' ? 'email' : 'text',
    value: isBlank(value) ? '' : String(value),
    placeholder: PLACEHOLDERS[field.key] || '',
    maxlength: field.key === 'currency' ? 3 : undefined,
    disabled: !canEdit,
  });
}

/** The summary line above the form: what the app is currently using. */
function summaryStats({ settings, engine, canEdit }) {
  return ui.el(
    'div',
    { class: 'stats' },
    ui.stat(settings.school_name || store.schoolName(), 'centre name', { tone: 'info' }),
    ui.stat(String(settings.currency || store.currency()).toUpperCase(), 'currency'),
    ui.stat(`Day ${settings.default_due_day || store.defaultDueDay()}`, 'invoice due day'),
    ui.stat(engine, 'database engine', { tone: 'neutral' }),
    ui.stat(canEdit ? 'Administrator' : 'Read only', 'your access', { tone: canEdit ? 'success' : 'warn' }),
  );
}

/** Values the API returned, in the order the schema lists them. */
function readOnlyList(settings, schema) {
  return ui.definitionList(
    schema.map((field) => [field.label, isBlank(settings[field.key]) ? 'Not set' : settings[field.key]]),
  );
}

/** The editable form. Saving replaces the cached settings so the shell updates. */
function settingsForm({ settings, schema, canEdit, onSaved, onReset }) {
  const element = ui.form(
    schema.map((field) =>
      ui.field(field.label, controlFor(field, settings[field.key], canEdit), HINTS[field.key] || ''),
    ),
    {
      submitLabel: 'Save settings',
      cancel: onReset,
      onSubmit: async (values) => {
        const result = await api.patch('/settings', ui.compact(values));
        store.setSettings(result.settings);
        ui.notify.ok(`Settings saved (${ui.fmtDateTime(result.savedAt)}).`);
        onSaved(result.settings);
      },
    },
  );
  return element;
}

/** Centre settings: identity, contact details, currency and the invoice due day. */
export default async function renderSettings(container, ctx) {
  async function draw() {
    ui.mount(container, ui.loading('Loading settings…'));
    try {
      const data = await api.get('/settings');
      const settings = data.settings || {};
      const schema = data.schema || [];
      const canEdit = Boolean(data.canEdit);

      ctx.setActions(canEdit ? ui.button('Reload', { kind: 'ghost', onClick: () => draw() }) : null);

      ui.mount(
        container,
        ui.el(
          'div',
          { class: 'stack' },
          summaryStats({ settings, engine: data.engine || '—', canEdit }),
          ui.card({
            title: 'Centre details',
            subtitle: canEdit
              ? 'Changes take effect immediately across the app'
              : 'Only an administrator can change these values',
            body: canEdit
              ? settingsForm({
                  settings,
                  schema,
                  canEdit,
                  onSaved: () => draw(),
                  onReset: () => draw(),
                })
              : readOnlyList(settings, schema),
          }),
          ui.card({
            title: 'How settings are used',
            subtitle: 'A quick tour of where these values appear',
            body: ui.el(
              'ul',
              { class: 'plain-list' },
              ui.el('li', {
                text: 'The centre name and tagline title the sidebar and invoices; the tagline falls back to “Early learning centre”.',
              }),
              ui.el('li', {
                text: 'The currency is the default for every new invoice, and it formats the amounts shown on the billing and dashboard screens.',
              }),
              ui.el('li', {
                text: 'The invoice due day prefills the due date when the office raises a monthly invoice (days 1-28 keep it safe in February).',
              }),
              ui.el('li', {
                text: 'The timezone is used by the server when it dates reminder emails; the address, phone and email are printed on invoices.',
              }),
              ui.el('li', {
                text: 'Clearing a field is not supported: leave it as it is and update it with a new value instead.',
              }),
            ),
          }),
        ),
      );
    } catch (error) {
      ui.mount(container, ui.errorState(error));
    }
  }

  await draw();
}
