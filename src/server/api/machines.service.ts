/**
 * ROA Services — Printing / Machines service (tenant-scoped repository layer).
 * Machines (print_machine) + counters (machine_counter_reading) + maintenances
 * + job-cost estimation. Every query is filtered by tenantId (fail-closed).
 */
import { eq, and, ilike, desc, asc, sql, count } from 'drizzle-orm';
import { db } from '../../db';
import { machine, machineCounter, maintenance, machineCost, material, auditLog } from '../../db/schema';
import { ApiError, notFound, conflict, badRequest } from './response';
import { computePrintJobPrice, type JobEstimateInput } from './pricing';

async function writeAudit(tenantId: string, userId: string, action: string, entity: string, entityId: string, oldValue: any, newValue: any) {
  try {
    await db.insert(auditLog).values({ tenantId, userId, action, entity, entityId, oldValue, newValue, createdAt: new Date() });
  } catch (e) {
    console.error('[audit] write failed', e);
  }
}

/* ----------------------------- Machines ----------------------------- */

export async function listMachines(tenantId: string, opts: { page: number; pageSize: number; search?: string; status?: string; sort: string; order: string; }) {
  const where = [
    eq(machine.tenantId, tenantId),
    opts.search ? or(ilike(machine.name, `%${opts.search}%`), ilike(machine.code, `%${opts.search}%`), ilike(machine.brand, `%${opts.search}%`)) : undefined,
    opts.status ? eq(machine.status, opts.status) : undefined,
  ].filter(Boolean) as any[];

  const sortCol = (machine as any)[opts.sort] ?? machine.createdAt;
  const orderBy = opts.order === 'asc' ? asc(sortCol) : desc(sortCol);

  const rows = await db.select().from(machine).where(where.length ? and(...where) : undefined).orderBy(orderBy).limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(machine).where(where.length ? and(...where) : undefined);
  return { data: rows, page: opts.page, pageSize: opts.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / opts.pageSize) };
}

export async function getMachine(tenantId: string, id: string) {
  const rows = await db.select().from(machine).where(and(eq(machine.tenantId, tenantId), eq(machine.id, id))).limit(1);
  if (!rows.length) throw notFound('Machine introuvable');
  return rows[0];
}

export async function createMachine(tenantId: string, userId: string, input: any) {
  if (input.code) {
    const existing = await db.select({ id: machine.id }).from(machine).where(and(eq(machine.tenantId, tenantId), eq(machine.code, input.code))).limit(1);
    if (existing.length) throw conflict('Une machine avec ce code existe déjà dans ce tenant');
  }
  const [created] = await db.insert(machine).values({
    tenantId,
    code: input.code,
    name: input.name,
    brand: input.brand ?? null,
    model: input.model ?? null,
    serial: input.serial ?? null,
    type: input.type ?? null,
    location: input.location ?? null,
    status: input.status ?? 'active',
    costPerPage: input.costPerPage != null ? String(input.costPerPage) : '0',
    acquisitionDate: input.acquisitionDate ?? null,
    acquisitionCost: input.acquisitionCost != null ? String(input.acquisitionCost) : null,
    warrantyUntil: input.warrantyUntil ?? null,
    supplier: input.supplier ?? null,
    nextMaintenance: input.nextMaintenance ?? null,
    assignedOperatorId: input.assignedOperatorId || null,
  }).returning();
  await writeAudit(tenantId, userId, 'MACHINE_CREATED', 'machine', created.id, null, created);
  return created;
}

export async function updateMachine(tenantId: string, userId: string, id: string, input: any) {
  const existing = await getMachine(tenantId, id);
  if (input.code && input.code !== existing.code) {
    const clash = await db.select({ id: machine.id }).from(machine).where(and(eq(machine.tenantId, tenantId), eq(machine.code, input.code))).limit(1);
    if (clash.length) throw conflict('Une machine avec ce code existe déjà dans ce tenant');
  }
  const patch: any = { updatedAt: new Date() };
  for (const k of ['code', 'name', 'brand', 'model', 'serial', 'type', 'location', 'status', 'acquisitionDate', 'warrantyUntil', 'supplier', 'nextMaintenance', 'assignedOperatorId']) {
    if (input[k] !== undefined) {
      const v = input[k] === '' ? null : input[k];
      patch[k] = (k === 'costPerPage' || k === 'acquisitionCost') ? String(v) : v;
    }
  }
  const [updated] = await db.update(machine).set(patch).where(and(eq(machine.tenantId, tenantId), eq(machine.id, id))).returning();
  await writeAudit(tenantId, userId, 'MACHINE_UPDATED', 'machine', id, existing, updated);
  return updated;
}

export async function deleteMachine(tenantId: string, userId: string, id: string) {
  const existing = await getMachine(tenantId, id);
  await db.delete(machine).where(and(eq(machine.tenantId, tenantId), eq(machine.id, id)));
  await writeAudit(tenantId, userId, 'MACHINE_DELETED', 'machine', id, existing, null);
  return { id, deleted: true };
}

/* ----------------------------- Counters ----------------------------- */

export async function listCounters(tenantId: string, machineId: string) {
  // ensure machine belongs to tenant (fail-closed)
  await getMachine(tenantId, machineId);
  return db.select().from(machineCounter).where(eq(machineCounter.machineId, machineId)).orderBy(desc(machineCounter.readAt));
}

export async function addCounter(tenantId: string, userId: string, machineId: string, input: any) {
  await getMachine(tenantId, machineId);
  const [created] = await db.insert(machineCounter).values({
    tenantId,
    machineId,
    bwCount: input.bwCount ?? 0,
    colorCount: input.colorCount ?? 0,
    a4Count: input.a4Count ?? 0,
    a3Count: input.a3Count ?? 0,
    readAt: input.readAt || new Date().toISOString().slice(0, 10),
  }).returning();
  await writeAudit(tenantId, userId, 'MACHINE_COUNTER_RECORDED', 'machine', machineId, null, created);
  return created;
}

/* ----------------------------- Maintenance ----------------------------- */

export async function listMaintenance(tenantId: string, machineId: string) {
  await getMachine(tenantId, machineId);
  return db.select().from(maintenance).where(eq(maintenance.machineId, machineId)).orderBy(desc(maintenance.performedAt));
}

export async function addMaintenance(tenantId: string, userId: string, machineId: string, input: any) {
  await getMachine(tenantId, machineId);
  const [created] = await db.insert(maintenance).values({
    tenantId,
    machineId,
    type: input.type,
    doneBy: input.doneBy || null,
    cost: input.cost != null ? String(input.cost) : '0',
    downtimeMin: input.downtimeMin ?? 0,
    notes: input.notes ?? null,
    performedAt: input.performedAt || new Date().toISOString().slice(0, 10),
  }).returning();
  await writeAudit(tenantId, userId, 'MACHINE_MAINTENANCE_' + String(input.type).toUpperCase(), 'machine', machineId, null, created);
  return created;
}

/* ----------------------------- Job price estimation ----------------------------- */

/**
 * Estimate a print job price. Resolves the effective machine cost-per-page from
 * the per-machine cost matrix (machine_cost) when available, otherwise the
 * machine's own costPerPage, and optionally a matching paper material cost.
 */
export async function estimateJob(tenantId: string, input: JobEstimateInput) {
  let costPerPage: number | null = null;
  let materialUnitCost: number | null = null;

  if (input.machineId) {
    const m = await getMachine(tenantId, input.machineId);
    const sides = input.duplex ? 'duplex' : 'simplex';
    const fmt = (input.format || 'A4').toUpperCase();
    const rows = await db.select().from(machineCost).where(and(
      eq(machineCost.tenantId, tenantId),
      eq(machineCost.machineId, input.machineId),
      eq(machineCost.format, fmt),
      eq(machineCost.color, !!input.color),
      eq(machineCost.sides, sides),
    )).limit(1);
    costPerPage = rows[0]?.costPerPage != null ? Number(rows[0].costPerPage) : (Number(m.costPerPage) || null);

    // optional: cheapest paper material in stock for the unit cost estimate
    if (input.paperType) {
      const papers = await db.select().from(material)
        .where(and(eq(material.tenantId, tenantId), eq(material.category, 'papier')))
        .orderBy(asc(material.unitCost)).limit(1);
      if (papers[0]) materialUnitCost = Number(papers[0].unitCost);
    }
  }

  return computePrintJobPrice(input, { costPerPage, materialUnitCost });
}
