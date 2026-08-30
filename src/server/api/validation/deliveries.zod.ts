/**
 * ROA Services — Zod validation schemas for the Delivery module.
 * Server-side only. Never trust the frontend.
 */
import { z } from 'zod';

const deliveryStatus = z.enum(['a_preparer', 'en_livraison', 'echec', 'nouvelle_tentative', 'livree']);
const deliveryMode = z.enum(['pickup', 'local', 'home']);

const optionalStr = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

export const CreateDeliverySchema = z.object({
  projectId: z.string().trim().min(1, 'projectId (commande) requis').max(40),
  mode: deliveryMode.default('local'),
  driverId: z.string().trim().uuid('driverId invalide').optional().or(z.literal('')),
  address: optionalStr(2000),
  city: optionalStr(80),
  phone: optionalStr(40),
  fees: z.number().min(0).max(1e10).optional(),
  status: deliveryStatus.default('a_preparer'),
  // NEVER accept tenantId from client — stripped below.
}).strict().strip();

export const UpdateDeliverySchema = z.object({
  mode: deliveryMode.optional(),
  driverId: z.string().trim().uuid('driverId invalide').optional().or(z.literal('')),
  address: optionalStr(2000),
  city: optionalStr(80),
  phone: optionalStr(40),
  fees: z.number().min(0).max(1e10).optional(),
  status: deliveryStatus.optional(),
}).strict().strip();

// A single delivery attempt (multi-tentative): success | fail.
export const DeliveryAttemptSchema = z.object({
  status: z.enum(['success', 'fail'], { errorMap: () => ({ message: 'status doit être success|fail' }) }),
  reason: optionalStr(2000),
  cost: z.number().min(0).max(1e10).optional(),
}).strict().strip();

export const DeliveryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: deliveryStatus.optional(),
  mode: deliveryMode.optional(),
  driverId: z.string().trim().uuid().optional(),
  projectId: z.string().trim().min(1).max(40).optional(),
});

// Reusable middleware guard: reject any tenant_id in body/query.
export const FORBIDDEN_DELIVERY_KEYS = ['tenantId', 'tenant_id', 'createdBy', 'updatedBy', 'id'];
