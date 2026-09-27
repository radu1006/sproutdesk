'use strict';

/**
 * Billing. Administrators raise a monthly invoice per child, record the
 * payments that arrive against it and watch the outstanding balance; families
 * see the same invoices for their own children, read-only.
 *
 * The API works in integer cents everywhere, so money is only turned into a
 * display string through `ui.fmtMoney`.
 */

import { api } from '../api.js';
import * as store from '../state.js';
import * as ui from '../ui.js';

const STATUSES = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Part paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
];

const STATUS_TONES = { unpaid: 'warn', partial: 'info', paid: 'success', void: 'neutral' };
const OPEN_STATUSES = ['unpaid', 'partial'];

const METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

const methodLabel = (value) => METHODS.find((row) => row.value === value)?.label || ui.label(value);
const statusLabel = (value) => STATUSES.find((row) => row.value === value)?.label || ui.label(value);
const currencyFor = (row) => (row && row.currency) || store.currency();

/**
 * The codes an administrator can bill in, as sent with the settings schema
 * (`store.loadCurrencyOptions()`). An invoice keeps the currency it was raised
 * in even if the centre has moved on, so that value stays pickable too.
 */
function currencyPicker({ value, options }) {
  const list = Array.isArray(options) ? options.slice() : [];
  const current = value ? String(value) : '';
  if (current && !list.some((option) => String(option.value) === current)) {
    list.unshift({ value: current, label: `${current} (current)` });
  }
  if (list.length) return ui.select({ name: 'currency', value: current, options: list });
  // No list (the settings call failed): a three letter code still works.
  return ui.input({ name: 'currency', value: current, maxlength: 3 });
}

/** '2026-09' -> 'September 2026'. */
function periodText(label) {
  if (!label) return '—';
  const [year, month] = String(label).split('-').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, 1));
  if (Number.isNaN(date.getTime())) return String(label);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Whole months as `YYYY-MM` labels, newest first. */
function monthOptions(count = 12) {
  const [year, month] = ui.today().split('-').map(Number);
  const options = [];
  for (let offset = 0; offset < count; offset += 1) {
    const value = new Date(Date.UTC(year, month - 1 - offset, 1)).toISOString().slice(0, 7);
    options.push({ value, label: periodText(value) });
  }
  return options;
}

/** An invoice is overdue while it is still open past its due date. */
function isOverdue(invoice) {
  return OPEN_STATUSES.includes(invoice.status) && Boolean(invoice.dueDate) && invoice.dueDate < ui.today();
}

/** Totals for a set of invoices: parents never see the admin summary route. */
function invoiceTotals(rows) {
  return rows.reduce(
    (totals, row) => {
      if (row.status === 'void') return totals;
      const balance = Math.max(0, (Number(row.amountCents) || 0) - (Number(row.paidCents) || 0));
      totals.billed += Number(row.amountCents) || 0;
      totals.paid += Number(row.paidCents) || 0;
      totals.open += balance;
      if (isOverdue(row)) totals.overdue += balance;
      return totals;
    },
    { billed: 0, paid: 0, open: 0, overdue: 0 },
  );
}

/** The due day configured in Settings, inside the month the invoice went out. */
function defaultDueDate(issuedOn) {
  const base = issuedOn || ui.today();
  const [year, month] = base.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(store.defaultDueDay(), lastDay);
  return `${base.slice(0, 7)}-${String(day).padStart(2, '0')}`;
}

/** Raise a new invoice (admin) or change an existing one (admin). */
function invoiceDialog({ invoice, children, currencies, onSaved }) {
  const editing = Boolean(invoice);
  const issuedOn = invoice?.issuedOn || ui.today();
  const currency = currencyFor(invoice);

  const element = ui.form(
    [
      editing
        ? null
        : ui.field(
            'Child',
            ui.select({
              name: 'childId',
              required: true,
              placeholder: 'Choose a child',
              options: children.map((child) => ({ value: String(child.id), label: store.childLabel(child) })),
            }),
          ),
      ui.field(
        'Amount',
        ui.input({
          name: 'amount',
          type: 'number',
          step: '0.01',
          min: 0,
          required: true,
          value: invoice ? (Number(invoice.amountCents) / 100).toFixed(2) : '',
        }),
        `Billed in ${currency}`,
      ),
      ui.field(
        'Period',
        ui.input({ name: 'period', value: invoice?.periodLabel || issuedOn.slice(0, 7), placeholder: 'YYYY-MM' }),
      ),
      ui.field('Issued on', ui.input({ name: 'issuedOn', type: 'date', value: issuedOn })),
      ui.field('Due date', ui.input({ name: 'dueDate', type: 'date', value: invoice?.dueDate || defaultDueDate(issuedOn) })),
      ui.field(
        'Currency',
        currencyPicker({ value: currency, options: currencies }),
        'New invoices default to the centre currency from Settings.',
      ),
      editing ? ui.field('Status', ui.select({ name: 'status', value: invoice.status, options: STATUSES })) : null,
      ui.field(
        'Description',
        ui.textarea({ name: 'description', value: invoice?.description || '', rows: 2, placeholder: 'Monthly care fee' }),
      ),
    ].filter(Boolean),
    {
      submitLabel: editing ? 'Save invoice' : 'Create invoice',
      cancel: ui.closeModal,
      onSubmit: async (values) => {
        const payload = ui.compact({ ...values, childId: values.childId ? Number(values.childId) : undefined });
        const result = editing
          ? await api.patch(`/invoices/${invoice.id}`, payload)
          : await api.post('/invoices', payload);
        ui.notify.ok(editing ? 'Invoice updated.' : `Invoice ${result.invoice.number} created.`);
        ui.closeModal();
        onSaved();
      },
    },
  );

  ui.openModal({ title: editing ? `Edit ${invoice.number}` : 'New invoice', body: element });
}

/** Record the payment that just arrived against an invoice (admin). */
function paymentDialog({ invoice, onSaved }) {
  const currency = currencyFor(invoice);
  const balance = Number(invoice.balanceCents ?? invoice.amountCents ?? 0);

  const element = ui.form(
    [
      ui.field(
        'Amount',
        ui.input({
          name: 'amount',
          type: 'number',
          step: '0.01',
          min: 0,
          required: true,
          value: balance > 0 ? (balance / 100).toFixed(2) : '',
        }),
        `Outstanding: ${ui.fmtMoney(balance, currency)}`,
      ),
      ui.field('Paid on', ui.input({ name: 'paidOn', type: 'date', value: ui.today() })),
      ui.field('Method', ui.select({ name: 'method', value: 'bank_transfer', options: METHODS })),
      ui.field('Reference', ui.input({ name: 'reference', placeholder: 'Receipt or transfer reference' })),
    ],
    {
      submitLabel: 'Record payment',
      cancel: ui.closeModal,
      onSubmit: async (values) => {
        await api.post(
          `/invoices/${invoice.id}/payments`,
          ui.compact({
            amount: values.amount,
            paidOn: values.paidOn,
            method: values.method,
            reference: values.reference,
          }),
        );
        ui.notify.ok(`Payment recorded for ${invoice.number}.`);
        ui.closeModal();
        onSaved();
      },
    },
  );

  ui.openModal({ title: `Record a payment · ${invoice.number}`, body: element });
}

/** One invoice with every payment recorded against it, loaded on demand. */
async function invoiceDetails({ invoice, isAdmin, onChanged }) {
  const box = ui.openModal({ title: `${invoice.number} · invoice`, body: ui.loading('Loading the invoice…') });
  const body = box.querySelector('.modal-body');

  /** `confirmAction` replaces this dialog, so the list refreshes behind it. */
  async function removePayment(payment) {
    const confirmed = await ui.confirmAction(
      `Remove the payment of ${ui.fmtMoney(payment.amountCents, currencyFor(invoice))}?`,
    );
    if (!confirmed) return;
    try {
      await api.delete(`/invoices/${invoice.id}/payments/${payment.id}`);
      ui.notify.ok('Payment removed.');
      onChanged();
    } catch (error) {
      ui.notify.error(error.message);
    }
  }

  async function removeInvoice(target) {
    const confirmed = await ui.confirmAction(`Delete invoice ${target.number}? Its payments are deleted too.`);
    if (!confirmed) return;
    try {
      await api.delete(`/invoices/${target.id}`);
      ui.notify.ok('Invoice deleted.');
      onChanged();
    } catch (error) {
      ui.notify.error(error.message);
    }
  }

  async function showDetails() {
    try {
      const data = await api.get(`/invoices/${invoice.id}`);
      const record = data.invoice;
      const currency = currencyFor(record);
      const rows = data.payments || [];
      const paid = rows.reduce((total, row) => total + (Number(row.amountCents) || 0), 0);
      const owed = Math.max(0, (Number(record.amountCents) || 0) - paid);

      const columns = [
        { header: 'Paid on', render: (row) => ui.fmtDate(row.paidOn, { weekday: false }) },
        { header: 'Method', render: (row) => methodLabel(row.method) },
        { header: 'Reference', render: (row) => row.reference || '—' },
        { header: 'Amount', render: (row) => ui.fmtMoney(row.amountCents, currency) },
        {
          header: '',
          render: (row) => (isAdmin ? ui.button('Remove', { kind: 'danger', onClick: () => removePayment(row) }) : null),
        },
      ];

      ui.mount(
        body,
        ui.el(
          'div',
          { class: 'stack' },
          ui.el(
            'div',
            { class: 'row' },
            ui.badge(statusLabel(record.status), STATUS_TONES[record.status] || 'neutral'),
            ui.badge(periodText(record.periodLabel), 'neutral'),
            isOverdue(record) ? ui.badge('Overdue', 'danger') : null,
          ),
          ui.el(
            'div',
            { class: 'stats' },
            ui.stat(ui.fmtMoney(record.amountCents, currency), 'invoice total'),
            ui.stat(ui.fmtMoney(paid, currency), 'received', { tone: 'success' }),
            ui.stat(ui.fmtMoney(owed, currency), 'outstanding', { tone: owed > 0 ? 'warn' : 'neutral' }),
          ),
          ui.definitionList([
            ['Child', [record.childName, record.classroomName].filter(Boolean).join(' · ')],
            ['Issued', ui.fmtDate(record.issuedOn, { weekday: false })],
            ['Due', ui.fmtDate(record.dueDate, { weekday: false })],
            ['Description', record.description],
          ]),
          ui.table({ columns, rows, empty: 'No payments recorded against this invoice yet.' }),
          ui.el(
            'div',
            { class: 'form-actions' },
            isAdmin
              ? ui.button('Record payment', {
                  onClick: () => paymentDialog({ invoice: record, onSaved: () => onChanged() }),
                })
              : null,
            isAdmin
              ? ui.button('Edit', {
                  kind: 'ghost',
                  onClick: () => invoiceDialog({ invoice: record, children: [], onSaved: () => onChanged() }),
                })
              : null,
            isAdmin ? ui.button('Delete invoice', { kind: 'danger', onClick: () => removeInvoice(record) }) : null,
            ui.button('Close', { kind: 'ghost', onClick: ui.closeModal }),
          ),
        ),
      );
    } catch (error) {
      ui.mount(body, ui.errorState(error));
    }
  }

  await showDetails();
}

/** Columns for the invoice table; the last column is role aware. */
function invoiceColumns({ isAdmin, onOpen, onPay, onEdit }) {
  return [
    { header: 'Number', render: (row) => row.number },
    { header: 'Child', render: (row) => [row.childName, row.classroomName].filter(Boolean).join(' · ') || '—' },
    { header: 'Period', render: (row) => periodText(row.periodLabel) },
    {
      header: 'Due',
      render: (row) =>
        ui.el(
          'div',
          { class: 'row' },
          ui.el('span', { text: ui.fmtDate(row.dueDate, { weekday: false }) }),
          isOverdue(row) ? ui.badge('Overdue', 'danger') : null,
        ),
    },
    { header: 'Amount', render: (row) => ui.fmtMoney(row.amountCents, currencyFor(row)) },
    { header: 'Paid', render: (row) => ui.fmtMoney(row.paidCents || 0, currencyFor(row)) },
    {
      header: 'Balance',
      render: (row) =>
        ui.fmtMoney(
          row.balanceCents ?? (Number(row.amountCents) || 0) - (Number(row.paidCents) || 0),
          currencyFor(row),
        ),
    },
    { header: 'Status', render: (row) => ui.badge(statusLabel(row.status), STATUS_TONES[row.status] || 'neutral') },
    {
      header: '',
      render: (row) =>
        ui.el(
          'div',
          { class: 'row' },
          ui.button('Open', { kind: 'ghost', onClick: () => onOpen(row) }),
          isAdmin && row.status !== 'void' ? ui.button('Payment', { kind: 'ghost', onClick: () => onPay(row) }) : null,
          isAdmin ? ui.button('Edit', { kind: 'ghost', onClick: () => onEdit(row) }) : null,
        ),
    },
  ];
}

/** Status / period / child filters, mirrored into the URL so links can be shared. */
function invoiceFilters(filters, { isAdmin, onChange }) {
  const box = ui.el(
    'div',
    { class: 'form-grid' },
    ui.field(
      'Status',
      ui.select({ name: 'status', value: filters.status, placeholder: 'Every status', options: STATUSES }),
    ),
    ui.field(
      'Period',
      ui.select({ name: 'period', value: filters.period, placeholder: 'Every period', options: monthOptions() }),
    ),
    isAdmin
      ? ui.field(
          'Child',
          ui.select({
            name: 'childId',
            value: filters.childId,
            placeholder: 'Every child',
            options: store.childOptions(),
          }),
        )
      : null,
  );

  for (const node of box.querySelectorAll('select')) {
    node.addEventListener('change', () => {
      const values = ui.formValues(box);
      onChange({ status: values.status || '', period: values.period || '', childId: values.childId || '' });
    });
  }

  return box;
}

/** Billing for one role: the office ledger for admins, the family statement for parents. */
export default async function renderBilling(container, ctx) {
  const isAdmin = ctx.user.role === 'admin';
  const filters = {
    status: ctx.query.status || '',
    period: ctx.query.period || '',
    childId: isAdmin ? ctx.query.childId || '' : '',
  };

  const query = () => ({
    status: filters.status || undefined,
    period: filters.period || undefined,
    childId: filters.childId || undefined,
  });

  async function draw() {
    ui.mount(container, ui.loading('Loading invoices…'));
    try {
      if (isAdmin) await store.loadChildren({ force: true }).catch(() => {});

      const [invoices, summary, currencies] = await Promise.all([
        api.get('/invoices', query()),
        isAdmin
          ? api.get('/invoices/summary', { period: filters.period || undefined }).catch(() => null)
          : Promise.resolve(null),
        // The codes the invoice form offers; if it fails the form falls back to text.
        isAdmin ? store.loadCurrencyOptions().catch(() => []) : Promise.resolve([]),
      ]);

      const rows = Array.isArray(invoices) ? invoices : [];
      const totals = invoiceTotals(rows);
      const currency = (summary && summary.currency) || store.currency();
      const billed = summary ? summary.billedCents : totals.billed;
      const received = summary ? summary.paidCents : totals.paid;
      const openCents = summary ? summary.openCents : totals.open;
      const overdueCents = summary ? summary.overdueCents : totals.overdue;

      const columns = invoiceColumns({
        isAdmin,
        onOpen: (row) => invoiceDetails({ invoice: row, isAdmin, onChanged: () => draw() }),
        onPay: (row) => paymentDialog({ invoice: row, onSaved: () => draw() }),
        onEdit: (row) => invoiceDialog({ invoice: row, children: [], currencies, onSaved: () => draw() }),
      });

      ctx.setActions(
        isAdmin
          ? ui.button('New invoice', {
              onClick: () => invoiceDialog({ children: store.children(), currencies, onSaved: () => draw() }),
            })
          : null,
      );

      ui.mount(
        container,
        ui.el(
          'div',
          { class: 'stack' },
          ui.el(
            'div',
            { class: 'stats' },
            ui.stat(summary ? summary.invoiceCount : rows.length, 'invoices in view', { tone: 'info' }),
            ui.stat(ui.fmtMoney(billed, currency), 'billed'),
            ui.stat(ui.fmtMoney(received, currency), 'received', { tone: 'success' }),
            ui.stat(ui.fmtMoney(openCents, currency), 'outstanding', { tone: openCents > 0 ? 'warn' : 'neutral' }),
            ui.stat(ui.fmtMoney(overdueCents, currency), 'overdue', { tone: overdueCents > 0 ? 'danger' : 'neutral' }),
          ),
          ui.card({
            title: 'Show',
            subtitle: summary
              ? `Totals for ${periodText(summary.period)} · office ledger`
              : 'Invoices raised for your children · read-only',
            body: invoiceFilters(filters, {
              isAdmin,
              onChange: (next) => {
                Object.assign(filters, next);
                ctx.go('/billing', query());
              },
            }),
          }),
          rows.length
            ? ui.card({
                title: `${rows.length} invoice${rows.length === 1 ? '' : 's'}`,
                subtitle: isAdmin
                  ? 'Newest first — open one to record a payment'
                  : 'Contact the office if a figure does not look right',
                body: ui.table({ columns, rows, empty: 'Nothing to show.' }),
              })
            : ui.emptyState('No invoices match these filters.', {
                hint: isAdmin
                  ? 'Use “New invoice” to raise the first one.'
                  : 'Invoices appear here as soon as the office raises them.',
              }),
        ),
      );
    } catch (error) {
      ui.mount(container, ui.errorState(error));
    }
  }

  await draw();
}
