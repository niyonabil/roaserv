/**
 * ROA Services — Zod validation schemas for the Billing module.
 * Covers Quotes (devis), Invoices (factures) + line items, and Payments (paiements) + refunds.
 * Server-side only. Never trust the frontend.
 *
 * Permission convention (documented):
 *   billing.read   — list/get quotes, invoices, payments, items
 *   billing.create — create quotes, invoices, payments, items, refunds
 *   billing.update — update/patch quotes, invoices, payments, items
 *   billing.delete — delete quotes, invoices, payments, items
 * One namespace (billing.*) governs the whole Billing domain, mirroring clients.*.
 */
import { z } from 'zod';

const optionalStr = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));
const uuid = z.string().uuid('Identifiant (UUID) invalide');
// Dates accepted as ISO 'YYYY-MM-DD' (or full timestamp); stored as date/timestamp.
const dateStr = z.string().trim().max(40).optional().or(z.literal(''));

/* ----------------------------- Quotes (devis) ----------------------------- */
export const quoteStatusEnum = z.enum(['draft', 'sent', 'accepted', 'rejected', 'cancelled', 'expired']);

export const CreateQuoteSchema = z.object({
  clientId: uuid,
  projectId: uuid.optional(),
  number: optionalStr(40),
  status: quoteStatusEnum.default('draft'),
  depositPct: z.number().min(0).max(100).optional(),
  totalHt: z.number().min(0).max(1e12).optional(),
  vat: z.number().min(0).max(1e12).optional(),
  totalTtc: z.number().min(0).max(1e12).optional(),
  issueDate: dateStr,
  validUntil: dateStr,
  notes: optionalStr(4000),
}).strict().strip();

export const UpdateQuoteSchema = z.object({
  clientId: uuid.optional(),
  projectId: uuid.optional(),
  number: optionalStr(40),
  status: quoteStatusEnum.optional(),
  depositPct: z.number().min(0).max(100).optional(),
  totalHt: z.number().min(0).max(1e12).optional(),
  vat: z.number().min(0).max(1e12).optional(),
  totalTtc: z.number().min(0).max(1e12).optional(),
  issueDate: dateStr,
  validUntil: dateStr,
  notes: optionalStr(4000),
}).strict().strip();

export const QuoteQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: quoteStatusEnum.optional(),
  clientId: uuid.optional(),
  sort: z.enum(['number', 'issueDate', 'validUntil', 'totalTtc', 'createdAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

/* ----------------------------- Invoices (factures) ----------------------------- */
export const invoiceStatusEnum = z.enum(['draft', 'sent', 'paid', 'partial', 'overdue', 'cancelled']);

export const CreateInvoiceSchema = z.object({
  clientId: uuid,
  projectId: uuid.optional(),
  number: z.string().trim().min(1, 'Le numéro de facture est requis').max(40),
  status: invoiceStatusEnum.default('draft'),
  ht: z.number().min(0).max(1e12).optional(),
  vat: z.number().min(0).max(1e12).optional(),
  ttc: z.number().min(0).max(1e12).optional(),
  dueDate: dateStr,
  issueDate: dateStr,
  notes: optionalStr(4000),
}).strict().strip();

export const UpdateInvoiceSchema = z.object({
  clientId: uuid.optional(),
  projectId: uuid.optional(),
  number: z.string().trim().min(1).max(40).optional(),
  status: invoiceStatusEnum.optional(),
  ht: z.number().min(0).max(1e12).optional(),
  vat: z.number().min(0).max(1e12).optional(),
  ttc: z.number().min(0).max(1e12).optional(),
  dueDate: dateStr,
  issueDate: dateStr,
  notes: optionalStr(4000),
}).strict().strip();

export const InvoiceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: invoiceStatusEnum.optional(),
  clientId: uuid.optional(),
  sort: z.enum(['number', 'dueDate', 'issueDate', 'ttc', 'createdAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

/* ----------------------------- Invoice line items ----------------------------- */
export const CreateInvoiceLineSchema = z.object({
  label: z.string().trim().min(1, 'Le libellé est requis').max(200),
  quantity: z.number().int().min(1).max(1e9).default(1),
  unitPrice: z.number().min(0).max(1e12).default(0),
  vatRate: z.number().min(0).max(100).default(20),
}).strict().strip();

export const UpdateInvoiceLineSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  quantity: z.number().int().min(1).max(1e9).optional(),
  unitPrice: z.number().min(0).max(1e12).optional(),
  vatRate: z.number().min(0).max(100).optional(),
}).strict().strip();

/* ----------------------------- Payments (paiements) ----------------------------- */
export const paymentMethodEnum = z.enum(['cash', 'transfer', 'card', 'online', 'mobile', 'other']);
export const paymentTypeEnum = z.enum(['deposit', 'solde', 'partial', 'full']);

export const CreatePaymentSchema = z.object({
  clientId: uuid,
  invoiceId: uuid.optional(),
  amount: z.number().positive('Le montant doit être > 0').max(1e12),
  method: paymentMethodEnum.default('cash'),
  type: paymentTypeEnum.default('partial'),
  reference: optionalStr(60),
  paidAt: z.string().trim().max(40).optional().or(z.literal('')),
  notes: optionalStr(4000),
}).strict().strip();

export const UpdatePaymentSchema = z.object({
  method: paymentMethodEnum.optional(),
  type: paymentTypeEnum.optional(),
  reference: optionalStr(60),
  paidAt: z.string().trim().max(40).optional().or(z.literal('')),
  notes: optionalStr(4000),
}).strict().strip();

export const PaymentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  clientId: uuid.optional(),
  invoiceId: uuid.optional(),
  method: paymentMethodEnum.optional(),
  type: paymentTypeEnum.optional(),
  sort: z.enum(['paidAt', 'amount', 'createdAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

/* ----------------------------- Refunds ----------------------------- */
export const CreateRefundSchema = z.object({
  amount: z.number().positive('Le montant du remboursement doit être > 0').max(1e12),
  reason: optionalStr(4000),
  reference: optionalStr(60),
}).strict().strip();

// Reusable middleware guard: reject any tenant/audit field in body/query.
export const FORBIDDEN_BILLING_KEYS = ['tenantId', 'tenant_id', 'createdBy', 'updatedBy', 'reversalOf'];
