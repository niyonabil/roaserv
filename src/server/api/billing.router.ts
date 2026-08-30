/**
 * ROA Services — Billing API (new architecture: Supabase/Drizzle/JWT/RBAC/tenant-scoped).
 * Quotes (devis), Invoices (factures) + line items, Payments (paiements) + refunds.
 * Chain: authenticate -> requireTenant -> requirePerm("billing.*") -> service -> Drizzle -> Supabase.
 *
 * Permission convention (single namespace, mirrors clients.*):
 *   billing.read / billing.create / billing.update / billing.delete
 */
import { Router, type Request, type Response } from 'express';
import { authenticate, requireTenant, requirePerm } from './auth.middleware';
import { ok, created, fail } from './response';
import {
  CreateQuoteSchema, UpdateQuoteSchema, QuoteQuerySchema,
  CreateInvoiceSchema, UpdateInvoiceSchema, InvoiceQuerySchema,
  CreateInvoiceLineSchema, UpdateInvoiceLineSchema,
  CreatePaymentSchema, UpdatePaymentSchema, PaymentQuerySchema,
  CreateRefundSchema, FORBIDDEN_BILLING_KEYS,
} from './validation/billing.zod';
import * as svc from './billing.service';

function stripTenantKeys(body: any) {
  // Defense in depth: never let a client-supplied tenant_id/audit field reach the service.
  for (const k of FORBIDDEN_BILLING_KEYS) delete body[k];
  return body;
}

export const billingRouter = Router();

/* ----------------------------- Quotes (devis) ----------------------------- */
billingRouter.get('/quotes', authenticate, requireTenant, requirePerm('billing.read'), async (req: Request, res: Response) => {
  try {
    const q = QuoteQuerySchema.parse(req.query);
    const result = await svc.listQuotes(req.auth!.tenantId, { page: q.page, pageSize: q.pageSize, search: q.search, status: q.status, clientId: q.clientId, sort: q.sort, order: q.order });
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

billingRouter.get('/quotes/:id', authenticate, requireTenant, requirePerm('billing.read'), async (req: Request, res: Response) => {
  try {
    const c = await svc.getQuote(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, c);
  } catch (e) { return fail(res, e); }
});

billingRouter.post('/quotes', authenticate, requireTenant, requirePerm('billing.create'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = CreateQuoteSchema.parse(body);
    const result = await svc.createQuote(req.auth!.tenantId, req.auth!.sub, input);
    return created(res, result);
  } catch (e) { return fail(res, e); }
});

billingRouter.patch('/quotes/:id', authenticate, requireTenant, requirePerm('billing.update'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = UpdateQuoteSchema.parse(body);
    const updated = await svc.updateQuote(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, input);
    return ok(res, updated);
  } catch (e) { return fail(res, e); }
});

billingRouter.delete('/quotes/:id', authenticate, requireTenant, requirePerm('billing.delete'), async (req: Request, res: Response) => {
  try {
    const updated = await svc.deleteQuote(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string);
    return ok(res, updated);
  } catch (e) { return fail(res, e); }
});

/* ----------------------------- Invoices (factures) ----------------------------- */
billingRouter.get('/invoices', authenticate, requireTenant, requirePerm('billing.read'), async (req: Request, res: Response) => {
  try {
    const q = InvoiceQuerySchema.parse(req.query);
    const result = await svc.listInvoices(req.auth!.tenantId, { page: q.page, pageSize: q.pageSize, search: q.search, status: q.status, clientId: q.clientId, sort: q.sort, order: q.order });
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

billingRouter.get('/invoices/:id', authenticate, requireTenant, requirePerm('billing.read'), async (req: Request, res: Response) => {
  try {
    const c = await svc.getInvoice(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, c);
  } catch (e) { return fail(res, e); }
});

billingRouter.post('/invoices', authenticate, requireTenant, requirePerm('billing.create'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = CreateInvoiceSchema.parse(body);
    const result = await svc.createInvoice(req.auth!.tenantId, req.auth!.sub, input);
    return created(res, result);
  } catch (e) { return fail(res, e); }
});

billingRouter.patch('/invoices/:id', authenticate, requireTenant, requirePerm('billing.update'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = UpdateInvoiceSchema.parse(body);
    const updated = await svc.updateInvoice(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, input);
    return ok(res, updated);
  } catch (e) { return fail(res, e); }
});

billingRouter.delete('/invoices/:id', authenticate, requireTenant, requirePerm('billing.delete'), async (req: Request, res: Response) => {
  try {
    const updated = await svc.deleteInvoice(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string);
    return ok(res, updated);
  } catch (e) { return fail(res, e); }
});

/* ----------------------------- Invoice line items ----------------------------- */
billingRouter.get('/invoices/:id/items', authenticate, requireTenant, requirePerm('billing.read'), async (req: Request, res: Response) => {
  try {
    const items = await svc.listInvoiceLines(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, items);
  } catch (e) { return fail(res, e); }
});

billingRouter.post('/invoices/:id/items', authenticate, requireTenant, requirePerm('billing.create'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = CreateInvoiceLineSchema.parse(body);
    const result = await svc.createInvoiceLine(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, input);
    return created(res, result);
  } catch (e) { return fail(res, e); }
});

billingRouter.patch('/invoices/:id/items/:lineId', authenticate, requireTenant, requirePerm('billing.update'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = UpdateInvoiceLineSchema.parse(body);
    const updated = await svc.updateInvoiceLine(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, req.params['lineId'] as string, input);
    return ok(res, updated);
  } catch (e) { return fail(res, e); }
});

billingRouter.delete('/invoices/:id/items/:lineId', authenticate, requireTenant, requirePerm('billing.delete'), async (req: Request, res: Response) => {
  try {
    const r = await svc.deleteInvoiceLine(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, req.params['lineId'] as string);
    return ok(res, r);
  } catch (e) { return fail(res, e); }
});

/* ----------------------------- Payments (paiements) ----------------------------- */
billingRouter.get('/payments', authenticate, requireTenant, requirePerm('billing.read'), async (req: Request, res: Response) => {
  try {
    const q = PaymentQuerySchema.parse(req.query);
    const result = await svc.listPayments(req.auth!.tenantId, { page: q.page, pageSize: q.pageSize, clientId: q.clientId, invoiceId: q.invoiceId, method: q.method, type: q.type, sort: q.sort, order: q.order });
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

billingRouter.get('/payments/:id', authenticate, requireTenant, requirePerm('billing.read'), async (req: Request, res: Response) => {
  try {
    const c = await svc.getPayment(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, c);
  } catch (e) { return fail(res, e); }
});

billingRouter.post('/payments', authenticate, requireTenant, requirePerm('billing.create'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = CreatePaymentSchema.parse(body);
    const result = await svc.createPayment(req.auth!.tenantId, req.auth!.sub, input);
    return created(res, result);
  } catch (e) { return fail(res, e); }
});

billingRouter.patch('/payments/:id', authenticate, requireTenant, requirePerm('billing.update'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = UpdatePaymentSchema.parse(body);
    const updated = await svc.updatePayment(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, input);
    return ok(res, updated);
  } catch (e) { return fail(res, e); }
});

billingRouter.delete('/payments/:id', authenticate, requireTenant, requirePerm('billing.delete'), async (req: Request, res: Response) => {
  try {
    const r = await svc.deletePayment(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string);
    return ok(res, r);
  } catch (e) { return fail(res, e); }
});

/* ----------------------------- Refunds (sub-route) ----------------------------- */
billingRouter.get('/payments/:id/refunds', authenticate, requireTenant, requirePerm('billing.read'), async (req: Request, res: Response) => {
  try {
    const items = await svc.listRefunds(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, items);
  } catch (e) { return fail(res, e); }
});

billingRouter.post('/payments/:id/refund', authenticate, requireTenant, requirePerm('billing.create'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = CreateRefundSchema.parse(body);
    const result = await svc.createRefund(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, input);
    return created(res, result);
  } catch (e) { return fail(res, e); }
});
