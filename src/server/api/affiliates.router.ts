/**
 * ROA Services — Affiliates router (tenant-scoped + RBAC).
 * Mounted under /api/v1 (see index.ts).
 */
import { Router, type Request, type Response } from 'express';
import * as svc from './affiliates.service';
import { authenticate, requireTenant, requirePerm } from './auth.middleware';
import { ok, created, fail } from './response';
import {
  CreateAffiliateSchema, UpdateAffiliateSchema, ReferralSchema, CommissionQuerySchema, FORBIDDEN_AFFILIATE_KEYS,
} from './validation/affiliates.zod';

function stripTenantKeys(body: any) {
  const out: any = { ...body };
  for (const k of FORBIDDEN_AFFILIATE_KEYS) delete out[k];
  return out;
}

export const affiliatesRouter = Router();

affiliatesRouter.get('/affiliates', authenticate, requireTenant, requirePerm('affiliates.read'), async (req: Request, res: Response) => {
  try {
    const q = CommissionQuerySchema.parse(req.query);
    const result = await svc.listAffiliates(req.auth!.tenantId, { page: q.page, pageSize: q.pageSize, search: (req.query as any).search });
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

affiliatesRouter.get('/affiliates/:id', authenticate, requireTenant, requirePerm('affiliates.read'), async (req: Request, res: Response) => {
  try {
    const a = await svc.getAffiliate(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, a);
  } catch (e) { return fail(res, e); }
});

affiliatesRouter.post('/affiliates', authenticate, requireTenant, requirePerm('affiliates.manage'), async (req: Request, res: Response) => {
  try {
    const input = CreateAffiliateSchema.parse(stripTenantKeys({ ...req.body }));
    const result = await svc.createAffiliate(req.auth!.tenantId, req.auth!.sub, input);
    return created(res, result);
  } catch (e) { return fail(res, e); }
});

affiliatesRouter.patch('/affiliates/:id', authenticate, requireTenant, requirePerm('affiliates.manage'), async (req: Request, res: Response) => {
  try {
    const input = UpdateAffiliateSchema.parse(stripTenantKeys({ ...req.body }));
    const result = await svc.updateAffiliate(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, input);
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

affiliatesRouter.delete('/affiliates/:id', authenticate, requireTenant, requirePerm('affiliates.manage'), async (req: Request, res: Response) => {
  try {
    const result = await svc.deleteAffiliate(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string);
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

// Record a referral/sale for an affiliate (commission computed server-side).
affiliatesRouter.post('/affiliates/:id/referrals', authenticate, requireTenant, requirePerm('affiliates.manage'), async (req: Request, res: Response) => {
  try {
    const input = ReferralSchema.parse(stripTenantKeys({ ...req.body }));
    const result = await svc.recordReferral(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, input);
    return created(res, result);
  } catch (e) { return fail(res, e); }
});

affiliatesRouter.get('/affiliates/:id/commissions', authenticate, requireTenant, requirePerm('affiliates.read'), async (req: Request, res: Response) => {
  try {
    const q = CommissionQuerySchema.parse(req.query);
    const result = await svc.listCommissions(req.auth!.tenantId, { page: q.page, pageSize: q.pageSize, status: q.status, affiliateId: req.params['id'] as string });
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

affiliatesRouter.get('/affiliates/:id/summary', authenticate, requireTenant, requirePerm('affiliates.read'), async (req: Request, res: Response) => {
  try {
    const result = await svc.affiliateSummary(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

affiliatesRouter.post('/commissions/:id/status', authenticate, requireTenant, requirePerm('affiliates.manage'), async (req: Request, res: Response) => {
  try {
    const status = (req.body as any).status;
    if (!status) return fail(res, new (require('./response').badRequest)('VALIDATION_ERROR', 'status requis'));
    const result = await svc.setCommissionStatus(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, status);
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});
