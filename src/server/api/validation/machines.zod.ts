/**
 * ROA Services — Zod validation schemas for the Printing / Machines module.
 * Server-side only. Never trust the frontend.
 */
import { z } from 'zod';

const optionalStr = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));
const numeric = z.number().min(0).max(1e12).optional();

export const MachineStatus = z.enum(['active', 'inactive', 'maintenance', 'retired']);

export const CreateMachineSchema = z.object({
  code: z.string().trim().min(1, 'Code requis').max(40),
  name: z.string().trim().min(1, 'Nom requis').max(200),
  brand: optionalStr(100),
  model: optionalStr(100),
  serial: optionalStr(120),
  type: optionalStr(60),
  location: optionalStr(120),
  status: MachineStatus.default('active'),
  costPerPage: numeric,
  acquisitionDate: optionalStr(10), // YYYY-MM-DD
  acquisitionCost: numeric,
  warrantyUntil: optionalStr(10),
  supplier: optionalStr(150),
  nextMaintenance: optionalStr(10),
  assignedOperatorId: z.string().uuid('UUID opérateur invalide').optional().or(z.literal('')),
}).strict().strip();

export const UpdateMachineSchema = z.object({
  code: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  brand: optionalStr(100),
  model: optionalStr(100),
  serial: optionalStr(120),
  type: optionalStr(60),
  location: optionalStr(120),
  status: MachineStatus.optional(),
  costPerPage: numeric,
  acquisitionDate: optionalStr(10),
  acquisitionCost: numeric,
  warrantyUntil: optionalStr(10),
  supplier: optionalStr(150),
  nextMaintenance: optionalStr(10),
  assignedOperatorId: z.string().uuid('UUID opérateur invalide').optional().or(z.literal('')),
}).strict().strip();

export const CounterReadingSchema = z.object({
  bwCount: z.number().int().min(0).max(1e15).optional(),
  colorCount: z.number().int().min(0).max(1e15).optional(),
  a4Count: z.number().int().min(0).max(1e15).optional(),
  a3Count: z.number().int().min(0).max(1e15).optional(),
  readAt: optionalStr(10),
}).strict().strip();

export const MaintenanceSchema = z.object({
  type: z.enum(['preventive', 'corrective', 'breakdown']),
  doneBy: z.string().uuid('UUID invalide').optional().or(z.literal('')),
  cost: numeric,
  downtimeMin: z.number().int().min(0).max(1_000_000).optional(),
  notes: optionalStr(4000),
  performedAt: optionalStr(10),
}).strict().strip();

export const EstimateJobSchema = z.object({
  machineId: z.string().uuid('UUID machine invalide').optional(),
  pages: z.number().int().min(1, 'pages >= 1').max(1_000_000),
  copies: z.number().int().min(1).max(100_000).default(1),
  color: z.boolean().default(false),
  duplex: z.boolean().default(false),
  format: z.enum(['A4', 'A3', 'A5']).default('A4'),
  paperType: optionalStr(40),
  finishingOptions: z.array(z.string().max(40)).optional(),
  urgencyKey: optionalStr(20),
}).strict().strip();

export const FORBIDDEN_MACHINE_KEYS = ['tenantId', 'tenant_id', 'createdBy', 'updatedBy'];
