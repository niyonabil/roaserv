/**
 * ROA Services — Stock / Inventory API (new Supabase/Drizzle/JWT/RBAC architecture).
 * Chain: authenticate -> requireTenant -> requirePerm("stock.*") -> service -> Drizzle.
 * Mounted under /api/v1 by index.ts; routes below resolve to /api/v1/stock/...
 */
import { Router, type Request, type Response } from 'express';
import { authenticate, requireTenant, requirePerm } from './auth.middleware';
import { ok, created, fail, badRequest } from './response';
import {
  CreateMaterialSchema, UpdateMaterialSchema, CreateStockMovementSchema, StockQuerySchema, FORBIDDEN_STOCK_KEYS,
} from './validation/stock.zod';
import * as svc from './stock.service';

function stripTenantKeys(body: any) {
  for (const k of FORBIDDEN_STOCK_KEYS) delete body[k];
  return body;
}

export const stockRouter = Router();

// GET /api/v1/stock  (list + filters + pagination + low-stock)
stockRouter.get('/stock', authenticate, requireTenant, requirePerm('stock.read'), async (req: Request, res: Response) => {
  try {
    const q = StockQuerySchema.parse(req.query);
    const result = await svc.listMaterials(req.auth!.tenantId, {
      page: q.page, pageSize: q.pageSize, search: q.search, category: q.category, lowStock: q.lowStock, sort: q.sort, order: q.order,
    });
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

// GET /api/v1/stock/alerts  (low-stock alerts)
stockRouter.get('/stock/alerts', authenticate, requireTenant, requirePerm('stock.read'), async (req: Request, res: Response) => {
  try {
    const rows = await svc.lowStockAlerts(req.auth!.tenantId);
    return ok(res, rows);
  } catch (e) { return fail(res, e); }
});

// GET /api/v1/stock/movements  (list movements)
stockRouter.get('/stock/movements', authenticate, requireTenant, requirePerm('stock.read'), async (req: Request, res: Response) => {
  try {
    const page = Number(req.query['page'] ?? 1) || 1;
    const pageSize = Math.min(Number(req.query['pageSize'] ?? 20) || 20, 100);
    const result = await svc.listMovements(req.auth!.tenantId, {
      page, pageSize, materialId: req.query['materialId'] as string | undefined, type: req.query['type'] as string | undefined,
    });
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

// GET /api/v1/stock/movements/:id
stockRouter.get('/stock/movements/:id', authenticate, requireTenant, requirePerm('stock.read'), async (req: Request, res: Response) => {
  try {
    const m = await svc.getMovement(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, m);
  } catch (e) { return fail(res, e); }
});

// POST /api/v1/stock/movements  (create movement: entrée/sortie/réservation)
stockRouter.post('/stock/movements', authenticate, requireTenant, requirePerm('stock.create'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = CreateStockMovementSchema.parse(body);
    const mv = await svc.createMovement(req.auth!.tenantId, req.auth!.sub, input);
    return created(res, mv);
  } catch (e) { return fail(res, e); }
});

// GET /api/v1/stock/:id
stockRouter.get('/stock/:id', authenticate, requireTenant, requirePerm('stock.read'), async (req: Request, res: Response) => {
  try {
    const m = await svc.getMaterial(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, m);
  } catch (e) { return fail(res, e); }
});

// POST /api/v1/stock  (create material)
stockRouter.post('/stock', authenticate, requireTenant, requirePerm('stock.create'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = CreateMaterialSchema.parse(body);
    const createdMaterial = await svc.createMaterial(req.auth!.tenantId, req.auth!.sub, input);
    return created(res, createdMaterial);
  } catch (e) { return fail(res, e); }
});

// PATCH /api/v1/stock/:id  (update material)
stockRouter.patch('/stock/:id', authenticate, requireTenant, requirePerm('stock.update'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = UpdateMaterialSchema.parse(body);
    const updated = await svc.updateMaterial(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, input);
    return ok(res, updated);
  } catch (e) { return fail(res, e); }
});

// DELETE /api/v1/stock/:id  (delete material)
stockRouter.delete('/stock/:id', authenticate, requireTenant, requirePerm('stock.delete'), async (req: Request, res: Response) => {
  try {
    const result = await svc.deleteMaterial(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string);
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});
