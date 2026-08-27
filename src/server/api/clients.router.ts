/**
 * ROA Services — Clients API (new architecture: Supabase/Drizzle/JWT/RBAC/tenant-scoped).
 * Chain: authenticate -> requireTenant -> requirePerm("clients.*") -> service -> Drizzle -> Supabase.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate, requireTenant, requirePerm } from './auth.middleware';
import { ok, created, fail, badRequest, ApiError } from './response';
import { CreateClientSchema, UpdateClientSchema, ClientQuerySchema, FORBIDDEN_CLIENT_KEYS } from './validation/clients.zod';
import * as svc from './clients.service';

function stripTenantKeys(body: any) {
  // Defense in depth: never let a client-supplied tenant_id reach the service.
  for (const k of FORBIDDEN_CLIENT_KEYS) delete body[k];
  return body;
}

export const clientsRouter = Router();

// GET /api/clients  (list + filters + pagination + tenant isolation)
clientsRouter.get('/clients', authenticate, requireTenant, requirePerm('clients.read'), async (req: Request, res: Response) => {
  try {
    const q = ClientQuerySchema.parse(req.query);
    const result = await svc.listClients(req.auth!.tenantId, {
      page: q.page, pageSize: q.pageSize, search: q.search, clientType: q.clientType, status: q.status, sort: q.sort, order: q.order,
    });
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

// GET /api/clients/:id
clientsRouter.get('/clients/:id', authenticate, requireTenant, requirePerm('clients.read'), async (req: Request, res: Response) => {
  try {
    const c = await svc.getClient(req.auth!.tenantId, req.params['id'] as string);
    return ok(res, c);
  } catch (e) { return fail(res, e); }
});

// POST /api/clients  (create)
clientsRouter.post('/clients', authenticate, requireTenant, requirePerm('clients.create'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = CreateClientSchema.parse(body);
    const createdClient = await svc.createClient(req.auth!.tenantId, req.auth!.sub, input);
    return created(res, createdClient);
  } catch (e) { return fail(res, e); }
});

// PATCH /api/clients/:id  (update)
clientsRouter.patch('/clients/:id', authenticate, requireTenant, requirePerm('clients.update'), async (req: Request, res: Response) => {
  try {
    const body = stripTenantKeys({ ...req.body });
    const input = UpdateClientSchema.parse(body);
    const updated = await svc.updateClient(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string, input);
    return ok(res, updated);
  } catch (e) { return fail(res, e); }
});

// DELETE /api/clients/:id  (soft-delete -> inactive)
clientsRouter.delete('/clients/:id', authenticate, requireTenant, requirePerm('clients.delete'), async (req: Request, res: Response) => {
  try {
    const updated = await svc.deleteClient(req.auth!.tenantId, req.auth!.sub, req.params['id'] as string);
    return ok(res, updated);
  } catch (e) { return fail(res, e); }
});
