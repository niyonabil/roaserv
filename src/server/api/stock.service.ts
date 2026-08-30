/**
 * ROA Services — Stock / Inventory service (tenant-scoped repository layer).
 * Materials (matériaux/consommables) + movements (entrée/sortie/réservation).
 * Every query is filtered by tenantId derived from the authenticated user.
 * No cross-tenant access is possible by construction (fail-closed).
 */
import { eq, and, or, ilike, desc, asc, sql, count, isNotNull } from 'drizzle-orm';
import { db } from '../../db';
import { material, stockMovement, auditLog } from '../../db/schema';
import { ApiError, notFound, conflict, badRequest } from './response';

async function writeAudit(tenantId: string, userId: string, action: string, entity: string, entityId: string, oldValue: any, newValue: any) {
  try {
    await db.insert(auditLog).values({ tenantId, userId, action, entity, entityId, oldValue, newValue, createdAt: new Date() });
  } catch (e) {
    console.error('[audit] write failed', e);
  }
}

/* ----------------------------- Materials ----------------------------- */

export async function listMaterials(tenantId: string, opts: {
  page: number; pageSize: number; search?: string; category?: string; lowStock?: boolean; sort: string; order: string;
}) {
  const where = [
    eq(material.tenantId, tenantId),
    opts.search ? or(ilike(material.name, `%${opts.search}%`), ilike(material.sku, `%${opts.search}%`), ilike(material.category, `%${opts.search}%`)) : undefined,
    opts.category ? eq(material.category, opts.category) : undefined,
    opts.lowStock ? and(isNotNull(material.min), sql`${material.qtyOnHand} <= ${material.min}`) : undefined,
  ].filter(Boolean) as any[];

  const sortCol = (material as any)[opts.sort] ?? material.name;
  const orderBy = opts.order === 'asc' ? asc(sortCol) : desc(sortCol);

  const rows = await db.select().from(material).where(where.length ? and(...where) : undefined).orderBy(orderBy).limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(material).where(where.length ? and(...where) : undefined);
  return { data: rows, page: opts.page, pageSize: opts.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / opts.pageSize) };
}

export async function getMaterial(tenantId: string, id: string) {
  const rows = await db.select().from(material).where(and(eq(material.tenantId, tenantId), eq(material.id, id))).limit(1);
  if (!rows.length) throw notFound('Matériau introuvable');
  return rows[0];
}

export async function createMaterial(tenantId: string, userId: string, input: any) {
  if (input.sku) {
    const existing = await db.select({ id: material.id }).from(material).where(and(eq(material.tenantId, tenantId), eq(material.sku, input.sku))).limit(1);
    if (existing.length) throw conflict('Un matériau avec ce SKU existe déjà dans ce tenant');
  }
  const [created] = await db.insert(material).values({
    tenantId,
    sku: input.sku,
    name: input.name,
    category: input.category,
    unit: input.unit ?? 'pcs',
    qtyOnHand: String(input.qtyOnHand ?? 0),
    qtyReserved: '0',
    min: input.min != null ? String(input.min) : '0',
    max: input.max != null ? String(input.max) : null,
    reorderLevel: input.reorderLevel != null ? String(input.reorderLevel) : null,
    unitCost: input.unitCost != null ? String(input.unitCost) : '0',
    preferredSupplierId: input.preferredSupplierId || null,
    notes: input.notes ?? null,
    createdBy: userId,
    updatedBy: userId,
  }).returning();
  await writeAudit(tenantId, userId, 'MATERIAL_CREATED', 'material', created.id, null, created);
  return created;
}

export async function updateMaterial(tenantId: string, userId: string, id: string, input: any) {
  const existing = await getMaterial(tenantId, id);
  if (input.sku && input.sku !== existing.sku) {
    const clash = await db.select({ id: material.id }).from(material).where(and(eq(material.tenantId, tenantId), eq(material.sku, input.sku))).limit(1);
    if (clash.length) throw conflict('Un matériau avec ce SKU existe déjà dans ce tenant');
  }
  const patch: any = { updatedBy: userId };
  for (const k of ['sku', 'name', 'category', 'unit', 'min', 'max', 'reorderLevel', 'unitCost', 'notes', 'preferredSupplierId']) {
    if (input[k] !== undefined) {
      const v = input[k] === '' ? null : input[k];
      patch[k] = (k === 'min' || k === 'max' || k === 'reorderLevel' || k === 'unitCost' || k === 'qtyOnHand') ? String(v) : v;
    }
  }
  const [updated] = await db.update(material).set(patch).where(and(eq(material.tenantId, tenantId), eq(material.id, id))).returning();
  await writeAudit(tenantId, userId, 'MATERIAL_UPDATED', 'material', id, existing, updated);
  return updated;
}

export async function deleteMaterial(tenantId: string, userId: string, id: string) {
  const existing = await getMaterial(tenantId, id);
  await db.delete(material).where(and(eq(material.tenantId, tenantId), eq(material.id, id)));
  await writeAudit(tenantId, userId, 'MATERIAL_DELETED', 'material', id, existing, null);
  return { id, deleted: true };
}

/* ----------------------------- Movements ----------------------------- */

export async function listMovements(tenantId: string, opts: { page: number; pageSize: number; materialId?: string; type?: string }) {
  const where = [
    eq(stockMovement.tenantId, tenantId),
    opts.materialId ? eq(stockMovement.materialId, opts.materialId) : undefined,
    opts.type ? eq(stockMovement.type, opts.type as any) : undefined,
  ].filter(Boolean) as any[];
  const rows = await db.select().from(stockMovement).where(where.length ? and(...where) : undefined).orderBy(desc(stockMovement.createdAt)).limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(stockMovement).where(where.length ? and(...where) : undefined);
  return { data: rows, page: opts.page, pageSize: opts.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / opts.pageSize) };
}

export async function getMovement(tenantId: string, id: string) {
  const rows = await db.select().from(stockMovement).where(and(eq(stockMovement.tenantId, tenantId), eq(stockMovement.id, id))).limit(1);
  if (!rows.length) throw notFound('Mouvement introuvable');
  return rows[0];
}

/**
 * Apply a stock movement and maintain material balances atomically.
 *  in/purchase/return      -> qtyOnHand += qty
 *  consumption/waste       -> qtyOnHand -= qty (must keep available >= 0)
 *  adjustment              -> qtyOnHand = qty (stocktake set)
 *  reservation             -> qtyReserved += qty
 *  reservation_release     -> qtyReserved -= qty
 *  transfer                -> log only (no balance change here)
 */
export async function createMovement(tenantId: string, userId: string, input: any) {
  const m = await getMaterial(tenantId, input.materialId);
  const qty = Number(input.qty);
  const curOnHand = Number(m.qtyOnHand);
  const curReserved = Number(m.qtyReserved);

  let newOnHand = curOnHand;
  let newReserved = curReserved;

  switch (input.type) {
    case 'in':
    case 'purchase':
    case 'return':
      newOnHand = curOnHand + qty;
      break;
    case 'consumption':
    case 'waste':
      if (curOnHand - curReserved < qty) {
        throw badRequest('INSUFFICIENT_STOCK', 'Stock disponible insuffisant pour cette sortie', { available: curOnHand - curReserved, requested: qty });
      }
      newOnHand = curOnHand - qty;
      break;
    case 'adjustment':
      newOnHand = qty;
      break;
    case 'reservation':
      newReserved = curReserved + qty;
      break;
    case 'reservation_release':
      newReserved = Math.max(0, curReserved - qty);
      break;
    case 'transfer':
      // balance unchanged (handled at PO/receipt level); only log
      break;
    default:
      throw badRequest('INVALID_MOVEMENT_TYPE', 'Type de mouvement inconnu');
  }

  const [mv] = await db.transaction(async (tx: any) => {
    const [upd] = await tx.update(material).set({
      qtyOnHand: String(newOnHand),
      qtyReserved: String(newReserved),
      updatedAt: new Date(),
      updatedBy: userId,
    }).where(and(eq(material.tenantId, tenantId), eq(material.id, input.materialId))).returning();
    const inserted = await tx.insert(stockMovement).values({
      tenantId,
      materialId: input.materialId,
      type: input.type,
      qty: String(qty),
      reason: input.reason || null,
      jobId: input.jobId || null,
      createdBy: userId,
    }).returning();
    await writeAudit(tenantId, userId, 'STOCK_MOVEMENT_' + String(input.type).toUpperCase(), 'material', input.materialId,
      { qtyOnHand: m.qtyOnHand, qtyReserved: m.qtyReserved },
      { qtyOnHand: String(newOnHand), qtyReserved: String(newReserved) });
    return [inserted[0]];
  });

  return mv;
}

/** Low-stock alerts: materials where qtyOnHand <= min (min set). */
export async function lowStockAlerts(tenantId: string) {
  const rows = await db.select().from(material)
    .where(and(eq(material.tenantId, tenantId), isNotNull(material.min), sql`${material.qtyOnHand} <= ${material.min}`))
    .orderBy(asc(material.name));
  return rows;
}
