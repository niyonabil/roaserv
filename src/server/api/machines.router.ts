/**
 * ROA Services — Printing / Machines API (new Supabase/Drizzle/JWT/RBAC architecture).
 * Chain: authenticate -> requireTenant -> requirePerm("machines.*") -> service -> Drizzle.
 * Mounted under /api/v1 by index.ts; routes below resolve to /api/v1/machines/...
 */
import { Router, type Request, type Response } from 'express';
import { authenticate, requireTenant, requirePerm } from './auth.middleware';
import { ok, created, fail } from './response';
import {
  CreateMachineSchema, UpdateMachineSchema, CounterReadingSchema, MaintenanceSchema, EstimateJobSchema, FORBIDDEN_MACHINE_KEYS,
} from './validation/machines.zod';
import * as svc from './machines.service';

function stripTenantKeys(body: any) {
  for (const k of FORBIDDEN_MACHINE_KEYS) delete body[k];
  return body;
}

export const machinesRouter = Router();

// GET /api/v1/machines  (list + filters + pagination)
machinesRouter.get('/machines', authenticate, requireTenant, requirePerm('machines.read'), async (req: Request, res: Response) => {
  try {
    const q = req.query;
    const page = Number(q['page'] ?? 1) || 1;
    const pageSize = Math.min(Number(q['pageSize'] ?? 20) || 20, 100);
    const result = await svc.listMachines(req.auth!.tenantId, {
      page, pageSize, search: q['search'] as string | undefined, status: q['status'] as string | undefined,
      sort: (q['sort'] as string) || 'createdAt', order: (q['order'] as string) || 'desc',
    });
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

// POST /api/v1/machines/estimate  (compute print-job price)
machinesRouter.post('/machines/estimate', authenticate, requireTenant, requirePerm('machines.read'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = EstimateJobSchema.parse(body);
    const estimate = await svc.estimateJob(req.auth!.tenantId, input);
    return ok(res, estimate);
  } catch (e) { return fail(res, e); }
});

// POST /api/v1/machines  (create machine)
machinesRouter.post('/machines', authenticate, requireTenant, requirePerm('machines.manage'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = CreateMachineSchema.parse(body);
    const createdMachine = await svc.createMachine(req.auth!.tenantId, req.auth!.sub, input);
    return created(res, createdMachine);
  } catch (e) { return fail(res, e); }
});

// GET /api/v1/machines/:id
machinesRouter.get('/machines/:id', authenticate, requireTenant, requirePerm('machines.read'), async (req: Request, res: Response) => {
  try {
    const m = await svc.getMachine(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, m);
  } catch (e) { return fail(res, e); }
});

// PATCH /api/v1/machines/:id
machinesRouter.patch('/machines/:id', authenticate, requireTenant, requirePerm('machines.manage'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = UpdateMachineSchema.parse(body);
    const updated = await svc.updateMachine(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, input);
    return ok(res, updated);
  } catch (e) { return fail(res, e); }
});

// DELETE /api/v1/machines/:id
machinesRouter.delete('/machines/:id', authenticate, requireTenant, requirePerm('machines.manage'), async (req: Request, res: Response) => {
  try {
    const result = await svc.deleteMachine(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string);
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

// GET /api/v1/machines/:id/counters
machinesRouter.get('/machines/:id/counters', authenticate, requireTenant, requirePerm('machines.read'), async (req: Request, res: Response) => {
  try {
    const rows = await svc.listCounters(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, rows);
  } catch (e) { return fail(res, e); }
});

// POST /api/v1/machines/:id/counters  (record counter reading)
machinesRouter.post('/machines/:id/counters', authenticate, requireTenant, requirePerm('machines.manage'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = CounterReadingSchema.parse(body);
    const result = await svc.addCounter(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, input);
    return created(res, result);
  } catch (e) { return fail(res, e); }
});

// GET /api/v1/machines/:id/maintenance
machinesRouter.get('/machines/:id/maintenance', authenticate, requireTenant, requirePerm('machines.read'), async (req: Request, res: Response) => {
  try {
    const rows = await svc.listMaintenance(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, rows);
  } catch (e) { return fail(res, e); }
});

// POST /api/v1/machines/:id/maintenance
machinesRouter.post('/machines/:id/maintenance', authenticate, requireTenant, requirePerm('machines.manage'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = MaintenanceSchema.parse(body);
    const result = await svc.addMaintenance(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, input);
    return created(res, result);
  } catch (e) { return fail(res, e); }
});
