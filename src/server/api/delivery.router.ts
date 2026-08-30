/**
 * ROA Services — Delivery router (tenant-scoped + RBAC).
 * Mounted under /api/v1 (see index.ts).
 */
import { Router, type Request, type Response } from 'express';
import * as svc from './delivery.service';
import { authenticate, requireTenant, requirePerm } from './auth.middleware';
import { ok, created, fail } from './response';
import {
  CreateDeliverySchema, UpdateDeliverySchema, DeliveryAttemptSchema, DeliveryQuerySchema, FORBIDDEN_DELIVERY_KEYS,
} from './validation/deliveries.zod';

function stripTenantKeys(body: any) {
  const out: any = { ...body };
  for (const k of FORBIDDEN_DELIVERY_KEYS) delete out[k];
  return out;
}

export const deliveryRouter = Router();

deliveryRouter.get('/deliveries', authenticate, requireTenant, requirePerm('delivery.read'), async (req: Request, res: Response) => {
  try {
    const q = DeliveryQuerySchema.parse(req.query);
    const result = await svc.listDeliveries(req.auth!.tenantId, { page: q.page, pageSize: q.pageSize, search: q.search, status: q.status, mode: q.mode, driverId: q.driverId, projectId: q.projectId });
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

deliveryRouter.get('/deliveries/:id', authenticate, requireTenant, requirePerm('delivery.read'), async (req: Request, res: Response) => {
  try {
    const d = await svc.getDelivery(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, d);
  } catch (e) { return fail(res, e); }
});

deliveryRouter.post('/deliveries', authenticate, requireTenant, requirePerm('delivery.create'), async (req: Request, res: Response) => {
  try {
    const input = CreateDeliverySchema.parse(stripTenantKeys({ ...req.body }));
    const result = await svc.createDelivery(req.auth!.tenantId, req.auth!.sub, input);
    return created(res, result);
  } catch (e) { return fail(res, e); }
});

deliveryRouter.patch('/deliveries/:id', authenticate, requireTenant, requirePerm('delivery.update'), async (req: Request, res: Response) => {
  try {
    const input = UpdateDeliverySchema.parse(stripTenantKeys({ ...req.body }));
    const result = await svc.updateDelivery(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, input);
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

deliveryRouter.delete('/deliveries/:id', authenticate, requireTenant, requirePerm('delivery.delete'), async (req: Request, res: Response) => {
  try {
    const result = await svc.deleteDelivery(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string);
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

deliveryRouter.get('/deliveries/:id/attempts', authenticate, requireTenant, requirePerm('delivery.read'), async (req: Request, res: Response) => {
  try {
    const rows = await svc.listAttempts(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, rows);
  } catch (e) { return fail(res, e); }
});

deliveryRouter.post('/deliveries/:id/attempts', authenticate, requireTenant, requirePerm('delivery.update'), async (req: Request, res: Response) => {
  try {
    const input = DeliveryAttemptSchema.parse(stripTenantKeys({ ...req.body }));
    const result = await svc.addAttempt(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, input);
    return created(res, result);
  } catch (e) { return fail(res, e); }
});
