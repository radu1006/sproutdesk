'use strict';

/**
 * Small DOM + formatting toolkit used by every view. There is no framework
 * here on purpose: `el()` builds real elements (so text is always treated as
 * text, never as HTML) and the rest are thin conveniences.
 */

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== 'list' && typeof value !== 'object') {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(3)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  return append(node, children);
}

export function frag(...children) {
  return append(document.createDocumentFragment(), children);
}

/* ---------------------------------------------------------------- formatting */

export function fmtMoney(cents, currency = 'USD') {
  if (cents === null || cents === undefined) return '—';
  const value = Number(cents) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function fmtDate(value, { weekday = true } = {}) {
  if (!value) return '—';
  const date = value.length <= 10 ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    weekday: weekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Relative wording for recent timestamps ("2 h ago"), absolute after a week. */
export function fmtRelative(value) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return String(value);
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} d ago`;
  return fmtDate(value, { weekday: false });
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function label(value) {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ------------------------------------------------------------------ building */

export function badge(text, tone = 'neutral') {
  return el('span', { class: `badge badge-${tone}`, text });
}

export function button(text, { onClick, kind = 'primary', type = 'button', disabled = false, title } = {}) {
  return el('button', {
    class: `button button-${kind}`,
    type,
    text,
    disabled,
    title,
    onClick,
  });
}

export function card({ title, subtitle, actions, body, class: className = '' } = {}) {
  const header =
    title || actions
      ? el(
          'div',
          { class: 'card-header' },
          el('div', {}, el('h2', { text: title || '' }), subtitle ? el('p', { class: 'muted small', text: subtitle }) : null),
          actions ? el('div', { class: 'card-actions' }, actions) : null,
        )
      : null;
  return el('section', { class: `card ${className}`.trim() }, header, el('div', { class: 'card-body' }, body ?? null));
}

export function stat(value, caption, { tone = 'neutral' } = {}) {
  return el(
    'div',
    { class: `stat stat-${tone}` },
    el('span', { class: 'stat-value', text: String(value) }),
    el('span', { class: 'stat-caption', text: caption }),
  );
}

export function loading(message = 'Loading…') {
  return el('div', { class: 'placeholder' }, el('span', { class: 'spinner' }), el('span', { text: message }));
}

export function emptyState(message, { hint } = {}) {
  return el(
    'div',
    { class: 'placeholder' },
    el('p', { text: message }),
    hint ? el('p', { class: 'muted small', text: hint }) : null,
  );
}

export function errorState(error) {
  return el(
    'div',
    { class: 'alert alert-error' },
    el('strong', { text: 'Something went wrong' }),
    el('p', { text: error?.message || String(error) }),
  );
}

export function toolbar(...children) {
  return el('div', { class: 'toolbar' }, children);
}

/* -------------------------------------------------------------- form controls */

export function input({
  name,
  type = 'text',
  value = '',
  placeholder,
  required = false,
  minlength,
  maxlength,
  min,
  max,
  step,
  autocomplete,
  disabled = false,
}) {
  return el('input', {
    class: 'input',
    name,
    type,
    value: value ?? '',
    placeholder,
    required,
    minLength: minlength,
    maxLength: maxlength,
    min,
    max,
    step,
    autocomplete,
    disabled,
  });
}

export function select({ name, value, options, required = false, placeholder, disabled = false }) {
  const element = el('select', { class: 'input', name, required, disabled });
  if (placeholder !== undefined) element.append(el('option', { value: '', text: placeholder }));
  for (const option of options) {
    element.append(
      el('option', {
        value: option.value,
        text: option.label,
        selected: String(option.value) === String(value ?? ''),
      }),
    );
  }
  return element;
}

export function textarea({
  name,
  value = '',
  rows = 3,
  placeholder,
  required = false,
  maxlength,
  disabled,
}) {
  const element = el('textarea', {
    class: 'input',
    name,
    rows,
    placeholder,
    required,
    maxLength: maxlength,
    disabled,
  });
  element.value = value ?? '';
  return element;
}

export function checkbox({ name, checked = false, label: labelText }) {
  return el(
    'label',
    { class: 'checkbox' },
    el('input', { type: 'checkbox', name, checked }),
    el('span', { text: labelText }),
  );
}

export function field(labelText, control, hint) {
  return el(
    'label',
    { class: 'field' },
    el('span', { class: 'field-label', text: labelText }),
    control,
    hint ? el('span', { class: 'muted small', text: hint }) : null,
  );
}

export function form(children, { onSubmit, submitLabel = 'Save', cancel, extraActions } = {}) {
  const element = el(
    'form',
    { class: 'form' },
    el('div', { class: 'form-grid' }, children),
    el(
      'div',
      { class: 'form-actions' },
      extraActions,
      cancel ? button('Cancel', { kind: 'ghost', type: 'button', onClick: cancel }) : null,
      button(submitLabel, { type: 'submit' }),
    ),
  );
  element.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = element.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await onSubmit(formValues(element));
    } catch (error) {
      notify.error(error.message);
    } finally {
      if (submit && document.body.contains(submit)) submit.disabled = false;
    }
  });
  return element;
}

/** Named inputs -> plain object. Numbers stay numbers, blanks become ''. */
export function formValues(element) {
  const values = {};
  for (const node of element.querySelectorAll('[name]')) {
    if (node.type === 'checkbox') values[node.name] = node.checked;
    else if (node.type === 'number') {
      values[node.name] = node.value === '' ? undefined : Number(node.value);
    } else values[node.name] = node.value;
  }
  return values;
}

/** Removes empty values so optional API fields are simply left out. */
export function compact(object) {
  const result = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === '' || value === null) continue;
    result[key] = value;
  }
  return result;
}

/* ------------------------------------------------------------------- tables */

export function table({ columns, rows, empty = 'Nothing to show yet.', onRowClick }) {
  if (!rows.length) return emptyState(empty);
  const head = el(
    'tr',
    {},
    columns.map((column) => el('th', { class: column.class || '', text: column.header })),
  );
  const body = rows.map((row) =>
    el(
      'tr',
      { class: onRowClick ? 'row-clickable' : '' },
      columns.map((column) => {
        const cell = el('td', { class: column.class || '' });
        append(cell, [column.render ? column.render(row) : row[column.key] ?? '—']);
        if (onRowClick) cell.addEventListener('click', () => onRowClick(row));
        return cell;
      }),
    ),
  );
  return el(
    'div',
    { class: 'table-wrap' },
    el('table', { class: 'data-table' }, el('thead', {}, head), el('tbody', {}, body)),
  );
}

/* ------------------------------------------------------------------- modals */

const modalRoot = () => document.getElementById('modal-root');

export function openModal({ title, body, footer }) {
  const box = el(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    el(
      'div',
      { class: 'modal-header' },
      el('h2', { text: title }),
      el('button', {
        class: 'icon-button',
        type: 'button',
        text: '✕',
        'aria-label': 'Close',
        onClick: closeModal,
      }),
    ),
    el('div', { class: 'modal-body' }, body),
    footer ? el('div', { class: 'modal-footer' }, footer) : null,
  );
  const overlay = el(
    'div',
    {
      class: 'overlay',
      onClick: (event) => {
        if (event.target === overlay) closeModal();
      },
    },
    box,
  );
  mount(modalRoot(), overlay);
  document.body.classList.add('modal-open');
  box.querySelector('input, select, textarea, button')?.focus();
  return box;
}

export function closeModal() {
  clear(modalRoot());
  document.body.classList.remove('modal-open');
}

export function modalOpen() {
  return modalRoot().childElementCount > 0;
}

export function confirmAction(
  message,
  { title = 'Please confirm', confirmLabel = 'Delete', tone = 'danger' } = {},
) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };
    openModal({
      title,
      body: el('p', { text: message }),
      footer: el(
        'div',
        { class: 'form-actions' },
        button('Cancel', { kind: 'ghost', onClick: () => finish(false) }),
        button(confirmLabel, { kind: tone, onClick: () => finish(true) }),
      ),
    });
  });
}

/* ------------------------------------------------------------------- toasts */

export function toast(message, tone = 'info') {
  const root = document.getElementById('toasts');
  const node = el('div', { class: `toast toast-${tone}`, text: message });
  root.append(node);
  setTimeout(() => {
    node.classList.add('toast-out');
    setTimeout(() => node.remove(), 400);
  }, 4200);
}

export const notify = {
  ok: (message) => toast(message, 'success'),
  info: (message) => toast(message, 'info'),
  error: (message) => toast(message, 'error'),
};

/* -------------------------------------------------------- common list pieces */

export function definitionList(pairs) {
  return el(
    'dl',
    { class: 'definition-list' },
    pairs.filter(Boolean).flatMap(([term, value]) => [
      el('dt', { text: term }),
      el('dd', {
        text: value === null || value === undefined || value === '' ? '—' : String(value),
      }),
    ]),
  );
}

export function pills(items) {
  return el(
    'div',
    { class: 'pills' },
    items.filter(Boolean).map((item) => el('span', { class: 'pill', text: item })),
  );
}
