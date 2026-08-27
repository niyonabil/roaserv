/**
 * ROA Services — Clients service (tenant-scoped repository layer).
 * Every query is filtered by tenantId derived from the authenticated user.
 * No cross-tenant access is possible by construction (fail-closed).
 */
import { eq, and, or, ilike, desc, asc, sql, count } from 'drizzle-orm';
import { db } from '../../db';
import { client, auditLog } from '../../db/schema';
import { ApiError, notFound, conflict, badRequest } from './response';

export async function listClients(tenantId: string, opts: {
  page: number; pageSize: number; search?: string; clientType?: string; status?: string; sort: string; order: string;
}) {
  const where = [
    eq(client.tenantId, tenantId),
    opts.search ? or(ilike(client.name, `%${opts.search}%`), ilike(client.customerCode, `%${opts.search}%`), ilike(client.email, `%${opts.search}%`), ilike(client.phone, `%${opts.search}%`), ilike(client.companyName, `%${opts.search}%`)) : undefined,
    opts.clientType ? eq(client.clientType, opts.clientType as any) : undefined,
    opts.status ? eq(client.status, opts.status as any) : undefined,
  ].filter(Boolean) as any[];

  const sortCol = (client as any)[opts.sort] ?? client.createdAt;
  const orderBy = opts.order === 'asc' ? asc(sortCol) : desc(sortCol);

  const rows = await db.select().from(client).where(where.length ? and(...where) : undefined).orderBy(orderBy).limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(client).where(where.length ? and(...where) : undefined);
  return { data: rows, page: opts.page, pageSize: opts.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / opts.pageSize) };
}

export async function getClient(tenantId: string, id: string) {
  const rows = await db.select().from(client).where(and(eq(client.tenantId, tenantId), eq(client.id, id))).limit(1);
  if (!rows.length) throw notFound('Client introuvable');
  return rows[0];
}

export async function createClient(tenantId: string, userId: string, input: any) {
  // customer code uniqueness within tenant enforced by unique index; pre-check for friendly error
  if (input.customerCode) {
    const existing = await db.select({ id: client.id }).from(client).where(and(eq(client.tenantId, tenantId), eq(client.customerCode, input.customerCode))).limit(1);
    if (existing.length) throw conflict('Un client avec ce code existe déjà dans ce tenant');
  }
  const [created] = await db.insert(client).values({
    tenantId,
    clientType: input.clientType ?? 'individual',
    customerCode: input.customerCode ?? null,
    name: input.name,
    companyName: input.companyName ?? null,
    cin: input.cin ?? null,
    ice: input.ice ?? null,
    if: input.ifField ?? null,
    rc: input.rc ?? null,
    vatNumber: input.vatNumber ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    phoneSecondary: input.phoneSecondary ?? null,
    contactName: input.contactName ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    postalCode: input.postalCode ?? null,
    country: input.country ?? 'MA',
    creditLimit: String(input.creditLimit ?? 0),
    paymentTerms: input.paymentTerms ?? 30,
    loyaltyDiscountPct: String(input.loyaltyDiscountPct ?? 0),
    status: input.status ?? 'active',
    createdBy: userId,
    updatedBy: userId,
  }).returning();
  await writeAudit(tenantId, userId, 'CLIENT_CREATED', 'client', created.id, null, created);
  return created;
}

export async function updateClient(tenantId: string, userId: string, id: string, input: any) {
  // ensure exists within tenant (fail-closed)
  const existing = await getClient(tenantId, id);
  if (input.customerCode && input.customerCode !== existing.customerCode) {
    const clash = await db.select({ id: client.id }).from(client).where(and(eq(client.tenantId, tenantId), eq(client.customerCode, input.customerCode))).limit(1);
    if (clash.length) throw conflict('Un client avec ce code existe déjà dans ce tenant');
  }
  const patch: any = { updatedAt: new Date(), updatedBy: userId };
  for (const k of ['clientType','customerCode','name','companyName','cin','ice','ifField','rc','vatNumber','email','phone','phoneSecondary','contactName','address','city','postalCode','country','creditLimit','paymentTerms','loyaltyDiscountPct','status','notes']) {
    if (input[k] !== undefined) {
      const col = k === 'ifField' ? 'if' : k;
      patch[col] = input[k] === '' ? null : input[k];
    }
  }
  if (patch.creditLimit !== undefined) patch.creditLimit = String(patch.creditLimit);
  if (patch.loyaltyDiscountPct !== undefined) patch.loyaltyDiscountPct = String(patch.loyaltyDiscountPct);
  const [updated] = await db.update(client).set(patch).where(and(eq(client.tenantId, tenantId), eq(client.id, id))).returning();
  await writeAudit(tenantId, userId, 'CLIENT_UPDATED', 'client', id, existing, updated);
  return updated;
}

/**
 * Soft-delete only: set status='inactive' rather than hard delete, to preserve
 * historical orders/invoices/payments linked to the client.
 * Hard delete is intentionally NOT provided to protect referential history.
 */
export async function deleteClient(tenantId: string, userId: string, id: string) {
  const existing = await getClient(tenantId, id);
  const [updated] = await db.update(client).set({ status: 'inactive', updatedAt: new Date(), updatedBy: userId }).where(and(eq(client.tenantId, tenantId), eq(client.id, id))).returning();
  await writeAudit(tenantId, userId, 'CLIENT_DELETED', 'client', id, existing, updated);
  return updated;
}

async function writeAudit(tenantId: string, userId: string, action: string, entity: string, entityId: string, oldValue: any, newValue: any) {
  try {
    await db.insert(auditLog).values({ tenantId, userId, action, entity, entityId, oldValue, newValue, createdAt: new Date() });
  } catch (e) {
    console.error('[audit] write failed', e);
  }
}
