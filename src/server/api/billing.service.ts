/**
 * ROA Services — Billing service (tenant-scoped repository layer).
 * Quotes (devis), Invoices (factures) + line items, Payments (paiements) + refunds.
 * Every query is filtered by tenantId derived from the authenticated user.
 * No cross-tenant access is possible by construction (fail-closed).
 */
import { eq, and, or, ilike, desc, asc, sql, count, sum } from 'drizzle-orm';
import { db } from '../../db';
import { quotation, invoice, invoiceLine, payment, refund, auditLog } from '../../db/schema';
import { ApiError, notFound, conflict, badRequest } from './response';

/* ============================ Quotes (devis) ============================ */
export async function listQuotes(tenantId: string, opts: {
  page: number; pageSize: number; search?: string; status?: string; clientId?: string; sort: string; order: string;
}) {
  const where = [
    eq(quotation.tenantId, tenantId),
    opts.clientId ? eq(quotation.clientId, opts.clientId as any) : undefined,
    opts.status ? eq(quotation.status, opts.status as any) : undefined,
    opts.search ? or(ilike(quotation.number, `%${opts.search}%`), ilike(quotation.notes, `%${opts.search}%`)) : undefined,
  ].filter(Boolean) as any[];

  const sortCol = (quotation as any)[opts.sort] ?? quotation.createdAt;
  const orderBy = opts.order === 'asc' ? asc(sortCol) : desc(sortCol);

  const rows = await db.select().from(quotation).where(where.length ? and(...where) : undefined).orderBy(orderBy).limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(quotation).where(where.length ? and(...where) : undefined);
  return { data: rows, page: opts.page, pageSize: opts.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / opts.pageSize) };
}

export async function getQuote(tenantId: string, id: string) {
  const rows = await db.select().from(quotation).where(and(eq(quotation.tenantId, tenantId), eq(quotation.id, id))).limit(1);
  if (!rows.length) throw notFound('Devis introuvable');
  return rows[0];
}

export async function createQuote(tenantId: string, userId: string, input: any) {
  if (input.number) {
    const clash = await db.select({ id: quotation.id }).from(quotation).where(and(eq(quotation.tenantId, tenantId), eq(quotation.number, input.number))).limit(1);
    if (clash.length) throw conflict('Un devis avec ce numéro existe déjà dans ce tenant');
  }
  const [created] = await db.insert(quotation).values({
    tenantId,
    clientId: input.clientId ?? null,
    projectId: input.projectId ?? null,
    number: input.number ?? null,
    status: input.status ?? 'draft',
    depositPct: String(input.depositPct ?? 50),
    totalHt: String(input.totalHt ?? 0),
    vat: String(input.vat ?? 0),
    totalTtc: String(input.totalTtc ?? 0),
    issueDate: input.issueDate || null,
    validUntil: input.validUntil || null,
    notes: input.notes ?? null,
    createdBy: userId,
    updatedBy: userId,
  }).returning();
  await writeAudit(tenantId, userId, 'QUOTE_CREATED', 'quote', created.id, null, created);
  return created;
}

export async function updateQuote(tenantId: string, userId: string, id: string, input: any) {
  const existing = await getQuote(tenantId, id);
  if (input.number && input.number !== existing.number) {
    const clash = await db.select({ id: quotation.id }).from(quotation).where(and(eq(quotation.tenantId, tenantId), eq(quotation.number, input.number))).limit(1);
    if (clash.length) throw conflict('Un devis avec ce numéro existe déjà dans ce tenant');
  }
  const patch: any = { updatedAt: new Date(), updatedBy: userId };
  for (const k of ['clientId','projectId','number','status','depositPct','totalHt','vat','totalTtc','issueDate','validUntil','notes']) {
    if (input[k] !== undefined) (patch as any)[k] = input[k] === '' ? null : input[k];
  }
  if (patch.depositPct !== undefined) patch.depositPct = String(patch.depositPct);
  if (patch.totalHt !== undefined) patch.totalHt = String(patch.totalHt);
  if (patch.vat !== undefined) patch.vat = String(patch.vat);
  if (patch.totalTtc !== undefined) patch.totalTtc = String(patch.totalTtc);
  const [updated] = await db.update(quotation).set(patch).where(and(eq(quotation.tenantId, tenantId), eq(quotation.id, id))).returning();
  await writeAudit(tenantId, userId, 'QUOTE_UPDATED', 'quote', id, existing, updated);
  return updated;
}

export async function deleteQuote(tenantId: string, userId: string, id: string) {
  const existing = await getQuote(tenantId, id);
  const [updated] = await db.update(quotation).set({ status: 'cancelled', updatedAt: new Date(), updatedBy: userId }).where(and(eq(quotation.tenantId, tenantId), eq(quotation.id, id))).returning();
  await writeAudit(tenantId, userId, 'QUOTE_DELETED', 'quote', id, existing, updated);
  return updated;
}

/* ============================ Invoices (factures) ============================ */
export async function listInvoices(tenantId: string, opts: {
  page: number; pageSize: number; search?: string; status?: string; clientId?: string; sort: string; order: string;
}) {
  const where = [
    eq(invoice.tenantId, tenantId),
    opts.clientId ? eq(invoice.clientId, opts.clientId as any) : undefined,
    opts.status ? eq(invoice.status, opts.status as any) : undefined,
    opts.search ? or(ilike(invoice.number, `%${opts.search}%`), ilike(invoice.notes, `%${opts.search}%`)) : undefined,
  ].filter(Boolean) as any[];

  const sortCol = (invoice as any)[opts.sort] ?? invoice.createdAt;
  const orderBy = opts.order === 'asc' ? asc(sortCol) : desc(sortCol);

  const rows = await db.select().from(invoice).where(where.length ? and(...where) : undefined).orderBy(orderBy).limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(invoice).where(where.length ? and(...where) : undefined);
  return { data: rows, page: opts.page, pageSize: opts.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / opts.pageSize) };
}

export async function getInvoice(tenantId: string, id: string) {
  const rows = await db.select().from(invoice).where(and(eq(invoice.tenantId, tenantId), eq(invoice.id, id))).limit(1);
  if (!rows.length) throw notFound('Facture introuvable');
  return rows[0];
}

export async function createInvoice(tenantId: string, userId: string, input: any) {
  if (input.number) {
    const clash = await db.select({ id: invoice.id }).from(invoice).where(and(eq(invoice.tenantId, tenantId), eq(invoice.number, input.number))).limit(1);
    if (clash.length) throw conflict('Une facture avec ce numéro existe déjà dans ce tenant');
  }
  const [created] = await db.insert(invoice).values({
    tenantId,
    clientId: input.clientId ?? null,
    projectId: input.projectId ?? null,
    number: input.number,
    status: input.status ?? 'draft',
    ht: String(input.ht ?? 0),
    vat: String(input.vat ?? 0),
    ttc: String(input.ttc ?? 0),
    dueDate: input.dueDate || null,
    issueDate: input.issueDate || null,
    notes: input.notes ?? null,
    createdBy: userId,
    updatedBy: userId,
  }).returning();
  await writeAudit(tenantId, userId, 'INVOICE_CREATED', 'invoice', created.id, null, created);
  return created;
}

export async function updateInvoice(tenantId: string, userId: string, id: string, input: any) {
  const existing = await getInvoice(tenantId, id);
  if (input.number && input.number !== existing.number) {
    const clash = await db.select({ id: invoice.id }).from(invoice).where(and(eq(invoice.tenantId, tenantId), eq(invoice.number, input.number))).limit(1);
    if (clash.length) throw conflict('Une facture avec ce numéro existe déjà dans ce tenant');
  }
  const patch: any = { updatedAt: new Date(), updatedBy: userId };
  for (const k of ['clientId','projectId','number','status','ht','vat','ttc','dueDate','issueDate','notes']) {
    if (input[k] !== undefined) (patch as any)[k] = input[k] === '' ? null : input[k];
  }
  if (patch.ht !== undefined) patch.ht = String(patch.ht);
  if (patch.vat !== undefined) patch.vat = String(patch.vat);
  if (patch.ttc !== undefined) patch.ttc = String(patch.ttc);
  const [updated] = await db.update(invoice).set(patch).where(and(eq(invoice.tenantId, tenantId), eq(invoice.id, id))).returning();
  await writeAudit(tenantId, userId, 'INVOICE_UPDATED', 'invoice', id, existing, updated);
  return updated;
}

export async function deleteInvoice(tenantId: string, userId: string, id: string) {
  const existing = await getInvoice(tenantId, id);
  const [updated] = await db.update(invoice).set({ status: 'cancelled', updatedAt: new Date(), updatedBy: userId }).where(and(eq(invoice.tenantId, tenantId), eq(invoice.id, id))).returning();
  await writeAudit(tenantId, userId, 'INVOICE_DELETED', 'invoice', id, existing, updated);
  return updated;
}

/* ============================ Invoice line items ============================ */
export async function listInvoiceLines(tenantId: string, invoiceId: string) {
  // ensure invoice belongs to tenant (fail-closed)
  await getInvoice(tenantId, invoiceId);
  return db.select().from(invoiceLine).where(and(eq(invoiceLine.tenantId, tenantId), eq(invoiceLine.invoiceId, invoiceId))).orderBy(asc(invoiceLine.createdAt));
}

export async function getInvoiceLine(tenantId: string, invoiceId: string, lineId: string) {
  await getInvoice(tenantId, invoiceId);
  const rows = await db.select().from(invoiceLine).where(and(eq(invoiceLine.tenantId, tenantId), eq(invoiceLine.invoiceId, invoiceId), eq(invoiceLine.id, lineId))).limit(1);
  if (!rows.length) throw notFound('Ligne de facture introuvable');
  return rows[0];
}

function computeLineTotals(input: any) {
  const qty = Number(input.quantity ?? 1);
  const unit = Number(input.unitPrice ?? 0);
  const vatRate = Number(input.vatRate ?? 20);
  const ht = Math.round(qty * unit * 100) / 100;
  const ttc = Math.round(ht * (1 + vatRate / 100) * 100) / 100;
  const vat = Math.round((ttc - ht) * 100) / 100;
  return { ht: String(ht), vat: String(vat), ttc: String(ttc) };
}

export async function createInvoiceLine(tenantId: string, userId: string, invoiceId: string, input: any) {
  await getInvoice(tenantId, invoiceId);
  const totals = computeLineTotals(input);
  const [created] = await db.insert(invoiceLine).values({
    tenantId,
    invoiceId,
    label: input.label,
    quantity: input.quantity ?? 1,
    unitPrice: String(input.unitPrice ?? 0),
    vatRate: String(input.vatRate ?? 20),
    ht: totals.ht,
    vat: totals.vat,
    ttc: totals.ttc,
  }).returning();
  await recomputeInvoiceTotals(tenantId, invoiceId);
  await writeAudit(tenantId, userId, 'INVOICE_LINE_CREATED', 'invoice_line', created.id, null, created);
  return created;
}

export async function updateInvoiceLine(tenantId: string, userId: string, invoiceId: string, lineId: string, input: any) {
  const existing = await getInvoiceLine(tenantId, invoiceId, lineId);
  const merged = { quantity: input.quantity ?? existing.quantity, unitPrice: input.unitPrice ?? existing.unitPrice, vatRate: input.vatRate ?? existing.vatRate, label: input.label ?? existing.label };
  const totals = computeLineTotals(merged);
  const patch: any = { label: merged.label, quantity: merged.quantity, unitPrice: String(merged.unitPrice), vatRate: String(merged.vatRate), ht: totals.ht, vat: totals.vat, ttc: totals.ttc };
  const [updated] = await db.update(invoiceLine).set(patch).where(and(eq(invoiceLine.tenantId, tenantId), eq(invoiceLine.invoiceId, invoiceId), eq(invoiceLine.id, lineId))).returning();
  await recomputeInvoiceTotals(tenantId, invoiceId);
  await writeAudit(tenantId, userId, 'INVOICE_LINE_UPDATED', 'invoice_line', lineId, existing, updated);
  return updated;
}

export async function deleteInvoiceLine(tenantId: string, userId: string, invoiceId: string, lineId: string) {
  const existing = await getInvoiceLine(tenantId, invoiceId, lineId);
  await db.delete(invoiceLine).where(and(eq(invoiceLine.tenantId, tenantId), eq(invoiceLine.invoiceId, invoiceId), eq(invoiceLine.id, lineId)));
  await recomputeInvoiceTotals(tenantId, invoiceId);
  await writeAudit(tenantId, userId, 'INVOICE_LINE_DELETED', 'invoice_line', lineId, existing, null);
  return { id: lineId, deleted: true };
}

async function recomputeInvoiceTotals(tenantId: string, invoiceId: string) {
  const lines = await db.select({ ht: sum(invoiceLine.ht), ttc: sum(invoiceLine.ttc) }).from(invoiceLine).where(and(eq(invoiceLine.tenantId, tenantId), eq(invoiceLine.invoiceId, invoiceId)));
  const ht = Number(lines[0]?.ht ?? 0);
  const ttc = Number(lines[0]?.ttc ?? 0);
  const vat = Math.round((ttc - ht) * 100) / 100;
  await db.update(invoice).set({ ht: String(Math.round(ht * 100) / 100), vat: String(vat), ttc: String(Math.round(ttc * 100) / 100), updatedAt: new Date() }).where(and(eq(invoice.tenantId, tenantId), eq(invoice.id, invoiceId)));
}

/* ============================ Payments (paiements) ============================ */
export async function listPayments(tenantId: string, opts: {
  page: number; pageSize: number; clientId?: string; invoiceId?: string; method?: string; type?: string; sort: string; order: string;
}) {
  const where = [
    eq(payment.tenantId, tenantId),
    opts.clientId ? eq(payment.clientId, opts.clientId as any) : undefined,
    opts.invoiceId ? eq(payment.invoiceId, opts.invoiceId as any) : undefined,
    opts.method ? eq(payment.method, opts.method as any) : undefined,
    opts.type ? eq(payment.type, opts.type as any) : undefined,
  ].filter(Boolean) as any[];

  const sortCol = (payment as any)[opts.sort] ?? payment.createdAt;
  const orderBy = opts.order === 'asc' ? asc(sortCol) : desc(sortCol);

  const rows = await db.select().from(payment).where(where.length ? and(...where) : undefined).orderBy(orderBy).limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(payment).where(where.length ? and(...where) : undefined);
  return { data: rows, page: opts.page, pageSize: opts.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / opts.pageSize) };
}

export async function getPayment(tenantId: string, id: string) {
  const rows = await db.select().from(payment).where(and(eq(payment.tenantId, tenantId), eq(payment.id, id))).limit(1);
  if (!rows.length) throw notFound('Paiement introuvable');
  return rows[0];
}

export async function createPayment(tenantId: string, userId: string, input: any) {
  const [created] = await db.insert(payment).values({
    tenantId,
    clientId: input.clientId,
    invoiceId: input.invoiceId ?? null,
    amount: String(input.amount),
    method: input.method ?? 'cash',
    type: input.type ?? 'partial',
    reference: input.reference ?? null,
    paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
    notes: input.notes ?? null,
    createdBy: userId,
  }).returning();
  await writeAudit(tenantId, userId, 'PAYMENT_CREATED', 'payment', created.id, null, created);
  return created;
}

export async function updatePayment(tenantId: string, userId: string, id: string, input: any) {
  const existing = await getPayment(tenantId, id);
  const patch: any = { updatedAt: new Date() };
  for (const k of ['method','type','reference','notes','paidAt']) {
    if (input[k] !== undefined) (patch as any)[k] = input[k] === '' ? null : (k === 'paidAt' ? new Date(input[k]) : input[k]);
  }
  if (Object.keys(patch).length <= 1) return existing;
  const [updated] = await db.update(payment).set(patch).where(and(eq(payment.tenantId, tenantId), eq(payment.id, id))).returning();
  await writeAudit(tenantId, userId, 'PAYMENT_UPDATED', 'payment', id, existing, updated);
  return updated;
}

export async function deletePayment(tenantId: string, userId: string, id: string) {
  const existing = await getPayment(tenantId, id);
  const linked = await db.select({ id: refund.id }).from(refund).where(eq(refund.paymentId, id)).limit(1);
  if (linked.length) throw conflict('Impossible de supprimer un paiement ayant des remboursements');
  await db.delete(payment).where(and(eq(payment.tenantId, tenantId), eq(payment.id, id)));
  await writeAudit(tenantId, userId, 'PAYMENT_DELETED', 'payment', id, existing, null);
  return { id, deleted: true };
}

/* ============================ Refunds ============================ */
export async function createRefund(tenantId: string, userId: string, paymentId: string, input: any) {
  const pay = await getPayment(tenantId, paymentId);
  const paid = Number(pay.amount);
  const refundSum = await db.select({ total: sum(refund.amount) }).from(refund).where(eq(refund.paymentId, paymentId));
  const already = Number(refundSum[0]?.total ?? 0);
  if (Number(input.amount) + already > paid + 1e-6) throw badRequest('REFUND_OVERFLOW', 'Le remboursement dépasse le montant payé');
  const [created] = await db.insert(refund).values({
    tenantId,
    paymentId,
    amount: String(input.amount),
    reason: input.reason ?? null,
    reference: input.reference ?? null,
    createdBy: userId,
  }).returning();
  await writeAudit(tenantId, userId, 'REFUND_CREATED', 'refund', created.id, null, created);
  return created;
}

export async function listRefunds(tenantId: string, paymentId: string) {
  await getPayment(tenantId, paymentId);
  return db.select().from(refund).where(and(eq(refund.tenantId, tenantId), eq(refund.paymentId, paymentId))).orderBy(desc(refund.createdAt));
}

/* ============================ Audit helper ============================ */
async function writeAudit(tenantId: string, userId: string, action: string, entity: string, entityId: string, oldValue: any, newValue: any) {
  try {
    await db.insert(auditLog).values({ tenantId, userId, action, entity, entityId, oldValue, newValue, createdAt: new Date() });
  } catch (e) {
    console.error('[audit] write failed', e);
  }
}
