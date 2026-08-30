/**
 * ROA Services — Zod validation schemas for the Affiliates module.
 * Server-side only. Never trust the frontend.
 */
import { z } from 'zod';

const commissionModel = z.enum(['percentage', 'fixed']);
const commissionStatus = z.enum(['pending', 'approved', 'paid', 'cancelled']);

const optionalStr = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

export const CreateAffiliateSchema = z.object({
  code: z.string().trim().min(1, 'code requis').max(40),
  name: z.string().trim().min(1, 'nom requis').max(200),
  referralLink: optionalStr(400),
  qrCode: optionalStr(400),
  commissionModel: commissionModel.default('percentage'),
  // NEVER accept tenantId from client — stripped below.
}).strict().strip();

export const UpdateAffiliateSchema = z.object({
  code: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  referralLink: optionalStr(400),
  qrCode: optionalStr(400),
  commissionModel: commissionModel.optional(),
}).strict().strip();

/**
 * Record a sale/referral for an affiliate. The commission is computed server-side:
 *  - percentage model: amount = orderValue * commissionRate / 100
 *  - fixed model:      amount = commissionRate (flat amount)
 * commissionRate default 10 (percent or flat unit depending on model).
 */
export const ReferralSchema = z.object({
  clientId: z.string().trim().min(1, 'clientId requis').max(40),
  projectId: z.string().trim().min(1).max(40).optional().or(z.literal('')),
  orderValue: z.number().positive('orderValue doit être > 0'),
  commissionRate: z.number().min(0).max(100).optional(),
}).strict().strip();

export const CommissionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: commissionStatus.optional(),
  affiliateId: z.string().trim().min(1).max(40).optional(),
});

export const FORBIDDEN_AFFILIATE_KEYS = ['tenantId', 'tenant_id', 'createdBy', 'updatedBy', 'id'];
