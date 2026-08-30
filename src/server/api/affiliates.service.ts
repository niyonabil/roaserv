/**
 * ROA Services — Affiliates service (tenant-scoped repository layer).
 * Affiliates + referrals (sales) + commission computation (server-side).
 * Every query is filtered by tenantId derived from the authenticated user.
 */
import { eq, and, ilike, desc, asc, count, sql, sum } from 'drizzle-orm';
import { db } from '../../db';
import { affiliate, affiliateReferral, commission, auditLog } from '../../db/schema';
import { ApiError, notFound, conflict } from './response';

async function writeAudit(tenantId: string, userId: string, action: string, entity: string, entityId: string, oldValue: any, newValue: any) {
  try {
    await db.insert(auditLog).values({ tenantId, userId, action, entity, entityId, oldValue, newValue, createdAt: new Date() });
  } catch (e) { console.error('[audit] write failed', e); }
}

export async function listAffiliates(tenantId: string, opts: { page: number; pageSize: number; search?: string; sort?: string; order?: string; }) {
  const where = [
    eq(affiliate.tenantId, tenantId),
    opts.search ? or(ilike(affiliate.name, `%${opts.search}%`), ilike(affiliate.code, `%${opts.search}%`)) : undefined,
  ].filter(Boolean) as any[];
  const orderBy = opts.order === 'asc' ? asc(affiliate.name) : desc(affiliate.name);
  const rows = await db.select().from(affiliate).where(where.length ? and(...where) : undefined).orderBy(orderBy).limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(affiliate).where(where.length ? and(...where) : undefined);
  return { data: rows, page: opts.page, pageSize: opts.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / opts.pageSize) };
}

export async function getAffiliate(tenantId: string, id: string) {
  const rows = await db.select().from(affiliate).where(and(eq(affiliate.tenantId, tenantId), eq(affiliate.id, id))).limit(1);
  if (!rows.length) throw notFound('Affilié introuvable');
  return rows[0];
}

export async function createAffiliate(tenantId: string, userId: string, input: any) {
  if (input.code) {
    const clash = await db.select({ id: affiliate.id }).from(affiliate).where(and(eq(affiliate.tenantId, tenantId), eq(affiliate.code, input.code))).limit(1);
    if (clash.length) throw conflict('Un affilié avec ce code existe déjà dans ce tenant');
  }
  const [created] = await db.insert(affiliate).values({
    tenantId,
    code: input.code,
    name: input.name,
    referralLink: input.referralLink ?? null,
    qrCode: input.qrCode ?? null,
    commissionModel: input.commissionModel ?? 'percentage',
  }).returning();
  await writeAudit(tenantId, userId, 'AFFILIATE_CREATED', 'affiliate', created.id, null, created);
  return created;
}

export async function updateAffiliate(tenantId: string, userId: string, id: string, input: any) {
  const existing = await getAffiliate(tenantId, id);
  if (input.code && input.code !== existing.code) {
    const clash = await db.select({ id: affiliate.id }).from(affiliate).where(and(eq(affiliate.tenantId, tenantId), eq(affiliate.code, input.code))).limit(1);
    if (clash.length) throw conflict('Un affilié avec ce code existe déjà dans ce tenant');
  }
  const patch: any = {};
  for (const k of ['code', 'name', 'referralLink', 'qrCode', 'commissionModel']) {
    if (input[k] !== undefined) patch[k] = input[k] === '' ? null : input[k];
  }
  const [updated] = await db.update(affiliate).set(patch).where(and(eq(affiliate.tenantId, tenantId), eq(affiliate.id, id))).returning();
  await writeAudit(tenantId, userId, 'AFFILIATE_UPDATED', 'affiliate', id, existing, updated);
  return updated;
}

export async function deleteAffiliate(tenantId: string, userId: string, id: string) {
  const existing = await getAffiliate(tenantId, id);
  await db.delete(affiliate).where(and(eq(affiliate.tenantId, tenantId), eq(affiliate.id, id)));
  await writeAudit(tenantId, userId, 'AFFILIATE_DELETED', 'affiliate', id, existing, null);
  return { id };
}

// Record a referral (sale) and compute commission server-side.
export async function recordReferral(tenantId: string, userId: string, affiliateId: string, input: any) {
  const aff = await getAffiliate(tenantId, affiliateId);
  const rate = input.commissionRate != null ? Number(input.commissionRate) : 10;
  const orderValue = Number(input.orderValue);
  const amount = aff.commissionModel === 'fixed' ? rate : (orderValue * rate) / 100;
  const [ref] = await db.insert(affiliateReferral).values({
    tenantId,
    affiliateId,
    clientId: input.clientId,
    projectId: input.projectId || null,
    orderValue: String(orderValue),
  }).returning();
  const [comm] = await db.insert(commission).values({
    tenantId,
    affiliateId,
    referralId: ref.id,
    amount: String(amount),
    status: 'pending',
    ruleType: aff.commissionModel,
  }).returning();
  await writeAudit(tenantId, userId, 'REFERRAL_RECORDED', 'affiliate_referral', ref.id, null, { ref, comm });
  return { referral: ref, commission: comm, computedAmount: amount };
}

export async function listCommissions(tenantId: string, opts: { page: number; pageSize: number; status?: string; affiliateId?: string; }) {
  const where = [
    eq(commission.tenantId, tenantId),
    opts.status ? eq(commission.status, opts.status as any) : undefined,
    opts.affiliateId ? eq(commission.affiliateId, opts.affiliateId as any) : undefined,
  ].filter(Boolean) as any[];
  const rows = await db.select().from(commission).where(where.length ? and(...where) : undefined).orderBy(desc(commission.createdAt)).limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(commission).where(where.length ? and(...where) : undefined);
  return { data: rows, page: opts.page, pageSize: opts.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / opts.pageSize) };
}

export async function setCommissionStatus(tenantId: string, userId: string, commissionId: string, status: string) {
  const rows = await db.select().from(commission).where(and(eq(commission.tenantId, tenantId), eq(commission.id, commissionId))).limit(1);
  if (!rows.length) throw notFound('Commission introuvable');
  const [updated] = await db.update(commission).set({ status }).where(and(eq(commission.tenantId, tenantId), eq(commission.id, commissionId))).returning();
  await writeAudit(tenantId, userId, 'COMMISSION_STATUS', 'commission', commissionId, rows[0], updated);
  return updated;
}

export async function affiliateSummary(tenantId: string, affiliateId: string) {
  const aff = await getAffiliate(tenantId, affiliateId);
  const [{ total }] = await db.select({ total: count() }).from(affiliateReferral).where(and(eq(affiliateReferral.tenantId, tenantId), eq(affiliateReferral.affiliateId, affiliateId)));
  const [{ earned }] = await db.select({ earned: sum(commission.amount) }).from(commission).where(and(eq(commission.tenantId, tenantId), eq(commission.affiliateId, affiliateId)));
  const [{ paid }] = await db.select({ paid: sum(commission.amount) }).from(commission).where(and(eq(commission.tenantId, tenantId), eq(commission.affiliateId, affiliateId), eq(commission.status, 'paid')));
  return { affiliate: aff, referrals: Number(total), totalEarned: Number(earned || 0), totalPaid: Number(paid || 0), pending: Number(earned || 0) - Number(paid || 0) };
}
