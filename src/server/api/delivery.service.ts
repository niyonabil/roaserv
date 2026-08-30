/**
 * ROA Services — Delivery service (tenant-scoped repository layer).
 * Multi-attempt deliveries (delivery + delivery_attempt).
 * Every query is filtered by tenantId derived from the authenticated user.
 */
import { eq, and, or, ilike, desc, asc, sql, count } from 'drizzle-orm';
import { db } from '../../db';
import { delivery, deliveryAttempt, auditLog } from '../../db/schema';
import { ApiError, notFound, conflict, badRequest } from './response';

async function writeAudit(tenantId: string, userId: string, action: string, entity: string, entityId: string, oldValue: any, newValue: any) {
  try {
    await db.insert(auditLog).values({ tenantId, userId, action, entity, entityId, oldValue, newValue, createdAt: new Date() });
  } catch (e) { console.error('[audit] write failed', e); }
}

export async function listDeliveries(tenantId: string, opts: { page: number; pageSize: number; search?: string; status?: string; mode?: string; driverId?: string; projectId?: string; sort?: string; order?: string; }) {
  const where = [
    eq(delivery.tenantId, tenantId),
    opts.status ? eq(delivery.status, opts.status as any) : undefined,
    opts.mode ? eq(delivery.mode, opts.mode) : undefined,
    opts.driverId ? eq(delivery.driverId, opts.driverId as any) : undefined,
    opts.projectId ? eq(delivery.projectId, opts.projectId as any) : undefined,
    opts.search ? or(ilike(delivery.city, `%${opts.search}%`), ilike(delivery.address, `%${opts.search}%`)) : undefined,
  ].filter(Boolean) as any[];
  const orderBy = opts.order === 'asc' ? asc(delivery.createdAt) : desc(delivery.createdAt);
  const rows = await db.select().from(delivery).where(where.length ? and(...where) : undefined).orderBy(orderBy).limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(delivery).where(where.length ? and(...where) : undefined);
  return { data: rows, page: opts.page, pageSize: opts.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / opts.pageSize) };
}

export async function getDelivery(tenantId: string, id: string) {
  const rows = await db.select().from(delivery).where(and(eq(delivery.tenantId, tenantId), eq(delivery.id, id))).limit(1);
  if (!rows.length) throw notFound('Livraison introuvable');
  return rows[0];
}

export async function createDelivery(tenantId: string, userId: string, input: any) {
  const [created] = await db.insert(delivery).values({
    tenantId,
    projectId: input.projectId,
    mode: input.mode ?? 'local',
    driverId: input.driverId || null,
    address: input.address ?? null,
    city: input.city ?? null,
    phone: input.phone ?? null,
    fees: String(input.fees ?? 0),
    status: input.status ?? 'a_preparer',
  }).returning();
  await writeAudit(tenantId, userId, 'DELIVERY_CREATED', 'delivery', created.id, null, created);
  return created;
}

export async function updateDelivery(tenantId: string, userId: string, id: string, input: any) {
  const existing = await getDelivery(tenantId, id);
  const patch: any = {};
  for (const k of ['mode', 'driverId', 'address', 'city', 'phone', 'fees', 'status']) {
    if (input[k] !== undefined) patch[k] = (k === 'fees') ? String(input[k]) : (k === 'driverId' ? (input[k] || null) : input[k]);
  }
  const [updated] = await db.update(delivery).set(patch).where(and(eq(delivery.tenantId, tenantId), eq(delivery.id, id))).returning();
  await writeAudit(tenantId, userId, 'DELIVERY_UPDATED', 'delivery', id, existing, updated);
  return updated;
}

export async function deleteDelivery(tenantId: string, userId: string, id: string) {
  const existing = await getDelivery(tenantId, id);
  await db.delete(delivery).where(and(eq(delivery.tenantId, tenantId), eq(delivery.id, id)));
  await writeAudit(tenantId, userId, 'DELIVERY_DELETED', 'delivery', id, existing, null);
  return { id };
}

export async function addAttempt(tenantId: string, userId: string, deliveryId: string, input: any) {
  const parent = await getDelivery(tenantId, deliveryId);
  const [created] = await db.insert(deliveryAttempt).values({
    tenantId,
    deliveryId,
    status: input.status,
    reason: input.reason ?? null,
    cost: input.cost != null ? String(input.cost) : null,
  }).returning();
  // update parent status based on attempt
  const newStatus = input.status === 'success' ? 'livree' : (parent.status === 'livree' ? 'livree' : 'nouvelle_tentative');
  await db.update(delivery).set({ status: newStatus }).where(and(eq(delivery.tenantId, tenantId), eq(delivery.id, deliveryId)));
  await writeAudit(tenantId, userId, 'DELIVERY_ATTEMPT', 'delivery_attempt', created.id, null, created);
  return created;
}

export async function listAttempts(tenantId: string, deliveryId: string) {
  const parent = await getDelivery(tenantId, deliveryId);
  const rows = await db.select().from(deliveryAttempt).where(and(eq(deliveryAttempt.tenantId, tenantId), eq(deliveryAttempt.deliveryId, deliveryId))).orderBy(desc(deliveryAttempt.attemptedAt));
  return rows;
}
