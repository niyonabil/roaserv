/**
 * ROA Services — Zod validation schemas for the Stock / Inventory module.
 * Server-side only. Never trust the frontend.
 */
import { z } from 'zod';

const optionalStr = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));
const numeric = z.number().min(0).max(1e12).optional();

export const StockMovementType = z.enum([
  'in', 'purchase', 'consumption', 'reservation', 'reservation_release',
  'adjustment', 'waste', 'return', 'transfer',
]);

export const CreateMaterialSchema = z.object({
  sku: z.string().trim().min(1, 'SKU requis').max(60),
  name: z.string().trim().min(1, 'Nom requis').max(200),
  category: z.string().trim().min(1, 'Catégorie requise').max(60),
  unit: z.string().trim().min(1).max(20).default('pcs'),
  qtyOnHand: numeric,
  min: numeric,
  max: numeric,
  reorderLevel: numeric,
  unitCost: numeric,
  preferredSupplierId: z.string().uuid('UUID fournisseur invalide').optional().or(z.literal('')),
}).strict().strip();

export const UpdateMaterialSchema = z.object({
  sku: z.string().trim().min(1).max(60).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  qtyOnHand: numeric,
  min: numeric,
  max: numeric,
  reorderLevel: numeric,
  unitCost: numeric,
  preferredSupplierId: z.string().uuid('UUID fournisseur invalide').optional().or(z.literal('')),
}).strict().strip();

export const CreateStockMovementSchema = z.object({
  materialId: z.string().uuid('materialId invalide'),
  type: StockMovementType,
  qty: z.number().positive('Quantité > 0').max(1e12),
  reason: optionalStr(2000),
  jobId: z.string().uuid('UUID job invalide').optional().or(z.literal('')),
}).strict().strip();

export const StockQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(60).optional(),
  lowStock: z.coerce.boolean().optional(),
  sort: z.enum(['name', 'sku', 'qtyOnHand', 'createdAt', 'updatedAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const FORBIDDEN_STOCK_KEYS = ['tenantId', 'tenant_id', 'createdBy', 'updatedBy', 'qtyReserved'];
