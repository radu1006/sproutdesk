'use strict';

/**
 * Billing: invoices per child per month and the payments recorded against
 * them. Amounts are handled in integer cents end to end.
 */

const express = require('express');
const db = require('../db');
const serialize = require('../lib/serialize');
const v = require('../lib/validate');
const { buildInsert, buildUpdate } = require('../lib/sql');
const { asyncHandler, requireRow, limitParam } = require('../lib/http');
const { nowIso, todayIso, addDays, periodLabel } = require('../lib/dates');
const { badRequest } = require('../lib/errors');
const access = require('../lib/access');
const centre = require('../lib/centre');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const STATUSES = ['unpaid', 'partial', 'paid', 'void'];
const METHODS = ['cash', 'bank_transfer', 'card', 'other'];

const SELECT_INVOICE = `
  SELECT i.*, ch.first_name, ch.last_name, cl.name AS classroom_name,
         COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0)
           AS paid_cents
    FROM invoices i
    JOIN children ch ON ch.id = i.child_id
    LEFT JOIN classrooms cl ON cl.id = ch.classroom_id
`;

router.use(requireAuth);

/** Derives `unpaid` / `partial` / `paid` from the payments recorded so far. */
function statusFor(amountCents, paidCents, current) {
  if (current === 'void') return 'void';
  if (paidCents <= 0) return 'unpaid';
  return paidCents >= amountCents ? 'paid' : 'partial';
}

async function nextInvoiceNumber(label) {
  const prefix = `SD-${label.replace('-', '')}`;
  const row = await db.get('SELECT COUNT(*) AS total FROM invoices WHERE period_label = ?', [label]);
  let sequence = Number(row.total) + 1;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `${prefix}-${String(sequence).padStart(4, '0')}`;
    const clash = await db.get('SELECT id FROM invoices WHERE number = ?', [candidate]);
    if (!clash) return candidate;
    sequence += 1;
  }
  throw badRequest('Could not allocate an invoice number for that period.', 'number_conflict');
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const conditions = [];
    const params = [];

    const ids = await access.accessibleChildIds(req.user);
    if (Array.isArray(ids)) {
      if (ids.length === 0) {
        res.json({ data: [] });
        return;
      }
      conditions.push(`i.child_id IN (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }

    const childId = v.queryInteger(req.query, 'childId', { min: 1 });
    if (childId) {
      await access.assertChildAccess(req.user, childId);
      conditions.push('i.child_id = ?');
      params.push(childId);
    }

    const status = v.enum(req.query, 'status', STATUSES);
    if (status) {
      conditions.push('i.status = ?');
      params.push(status);
    }

    const period = v.text(req.query, 'period', { max: 7 });
    if (period) {
      v.assert(/^\d{4}-\d{2}$/.test(period), '"period" must look like YYYY-MM.');
      conditions.push('i.period_label = ?');
      params.push(period);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db.all(
      `${SELECT_INVOICE} ${where} ORDER BY i.issued_on DESC, i.id DESC LIMIT ?`,
      [...params, limitParam(req.query, { fallback: 100, max: 300 })],
    );
    res.json({ data: rows.map(serialize.invoice) });
  }),
);

router.get(
  '/summary',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const period = v.text(req.query, 'period', { max: 7 }) ?? periodLabel(todayIso());
    v.assert(/^\d{4}-\d{2}$/.test(period), '"period" must look like YYYY-MM.');

    const row = await db.get(
      `SELECT
          COUNT(*) AS invoice_count,
          COALESCE(SUM(i.amount_cents), 0) AS billed_cents,
          COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.amount_cents ELSE 0 END), 0) AS paid_cents,
          COALESCE(SUM(CASE WHEN i.status IN ('unpaid', 'partial') THEN i.amount_cents ELSE 0 END), 0)
            AS open_cents,
          COALESCE(SUM(CASE WHEN i.status IN ('unpaid', 'partial') AND i.due_date < ?
                            THEN i.amount_cents ELSE 0 END), 0) AS overdue_cents
        FROM invoices i
       WHERE i.period_label = ? AND i.status <> 'void'`,
      [todayIso(), period],
    );

    res.json({
      data: {
        period,
        invoiceCount: Number(row.invoice_count),
        billedCents: Number(row.billed_cents),
        paidCents: Number(row.paid_cents),
        openCents: Number(row.open_cents),
        overdueCents: Number(row.overdue_cents),
        currency: await centre.currency(),
      },
    });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get(`${SELECT_INVOICE} WHERE i.id = ?`, [req.params.id]);
    requireRow(row, 'That invoice does not exist.');
    await access.assertChildAccess(req.user, row.child_id);

    const payments = await db.all(
      'SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on DESC, id DESC',
      [row.id],
    );
    res.json({
      data: { invoice: serialize.invoice(row), payments: payments.map(serialize.payment) },
    });
  }),
);

router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const childId = v.integer(req.body, 'childId', { required: true, min: 1 });
    const child = await db.get('SELECT id FROM children WHERE id = ?', [childId]);
    if (!child) throw badRequest('The selected child does not exist.');

    const amountCents = v.money(req.body, 'amount', { required: true, min: 1 });
    const issuedOn = v.dateOnly(req.body, 'issuedOn') ?? todayIso();
    const label = v.text(req.body, 'period', { max: 7 }) ?? periodLabel(issuedOn);
    v.assert(/^\d{4}-\d{2}$/.test(label), '"period" must look like YYYY-MM.');

    const dueDate = v.dateOnly(req.body, 'dueDate') ?? addDays(issuedOn, 14);
    const description = v.text(req.body, 'description', { max: 500 });
    // An invoice keeps its own currency; the default comes from Settings.
    const currency = (
      v.text(req.body, 'currency', { max: 3 }) ?? (await centre.currency())
    ).toUpperCase();
    const number = v.text(req.body, 'number', { max: 40 }) ?? (await nextInvoiceNumber(label));

    const clash = await db.get('SELECT id FROM invoices WHERE number = ?', [number]);
    if (clash) throw badRequest('Another invoice already uses that number.');

    const now = nowIso();
    const { sql, params } = buildInsert('invoices', {
      child_id: child.id,
      number,
      period_label: label,
      description: description ?? null,
      amount_cents: amountCents,
      currency,
      due_date: dueDate,
      issued_on: issuedOn,
      status: 'unpaid',
      created_by: req.user.id,
      created_at: now,
      updated_at: now,
    });
    const { id } = await db.run(sql, params);
    const row = await db.get(`${SELECT_INVOICE} WHERE i.id = ?`, [id]);
    res.status(201).json({ data: { invoice: serialize.invoice(row) } });
  }),
);

router.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const existing = await db.get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    requireRow(existing, 'That invoice does not exist.');

    const amountCents = v.money(req.body, 'amount', { min: 1 });
    const patch = {
      description: v.text(req.body, 'description', { max: 500 }),
      due_date: v.dateOnly(req.body, 'dueDate'),
      issued_on: v.dateOnly(req.body, 'issuedOn'),
      currency: v.text(req.body, 'currency', { max: 3 }),
      period_label: v.text(req.body, 'period', { max: 7 }),
      status: v.enum(req.body, 'status', STATUSES, { nullable: false }),
      amount_cents: amountCents,
      updated_at: nowIso(),
    };
    if (patch.currency) patch.currency = patch.currency.toUpperCase();
    if (patch.period_label) {
      v.assert(/^\d{4}-\d{2}$/.test(patch.period_label), '"period" must look like YYYY-MM.');
    }
    if (existing.status === 'void' && patch.status === undefined) {
      throw badRequest('A void invoice cannot be edited.', 'invoice_void');
    }

    const statement = buildUpdate('invoices', patch, 'id = ?', [existing.id]);
    if (statement) await db.run(statement.sql, statement.params);

    const row = await db.get(`${SELECT_INVOICE} WHERE i.id = ?`, [existing.id]);
    res.json({ data: { invoice: serialize.invoice(row) } });
  }),
);

/** Recomputes the invoice status from the payments on record. */
async function refreshStatus(invoiceId) {
  const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  requireRow(invoice, 'That invoice does not exist.');
  const totals = await db.get(
    'SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents FROM payments WHERE invoice_id = ?',
    [invoiceId],
  );
  const paidCents = Number(totals.paid_cents);
  const status = statusFor(Number(invoice.amount_cents), paidCents, invoice.status);

  await db.run('UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?', [
    status,
    nowIso(),
    invoiceId,
  ]);
  return { paidCents, status };
}

router.post(
  '/:id/payments',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    requireRow(invoice, 'That invoice does not exist.');
    if (invoice.status === 'void') throw badRequest('A void invoice cannot be paid.', 'invoice_void');

    const amountCents = v.money(req.body, 'amount', { required: true, min: 1 });
    const paidOn = v.dateOnly(req.body, 'paidOn') ?? todayIso();
    const method = v.enum(req.body, 'method', METHODS, { nullable: false }) ?? 'bank_transfer';
    const reference = v.text(req.body, 'reference', { max: 120 });

    const { sql, params } = buildInsert('payments', {
      invoice_id: invoice.id,
      amount_cents: amountCents,
      paid_on: paidOn,
      method,
      reference: reference ?? null,
      recorded_by: req.user.id,
      created_at: nowIso(),
    });
    const { id } = await db.run(sql, params);
    const payment = await db.get('SELECT * FROM payments WHERE id = ?', [id]);
    const totals = await refreshStatus(invoice.id);
    const updated = await db.get(`${SELECT_INVOICE} WHERE i.id = ?`, [invoice.id]);

    res.status(201).json({
      data: {
        payment: serialize.payment(payment),
        invoice: serialize.invoice(updated),
        paidCents: totals.paidCents,
      },
    });
  }),
);

router.delete(
  '/:id/payments/:paymentId',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    requireRow(invoice, 'That invoice does not exist.');
    const payment = await db.get('SELECT * FROM payments WHERE id = ? AND invoice_id = ?', [
      req.params.paymentId,
      invoice.id,
    ]);
    requireRow(payment, 'That payment does not exist.');

    await db.run('DELETE FROM payments WHERE id = ?', [payment.id]);
    const totals = await refreshStatus(invoice.id);
    const updated = await db.get(`${SELECT_INVOICE} WHERE i.id = ?`, [invoice.id]);
    res.json({
      data: {
        deleted: true,
        paymentId: Number(payment.id),
        invoice: serialize.invoice(updated),
        paidCents: totals.paidCents,
      },
    });
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    requireRow(invoice, 'That invoice does not exist.');
    await db.run('DELETE FROM payments WHERE invoice_id = ?', [invoice.id]);
    await db.run('DELETE FROM invoices WHERE id = ?', [invoice.id]);
    res.json({ data: { deleted: true, invoiceId: Number(invoice.id) } });
  }),
);

module.exports = router;
module.exports.STATUSES = STATUSES;
module.exports.METHODS = METHODS;
