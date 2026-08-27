/**
 * ROA Services — Zod validation schemas for the Clients module.
 * Server-side only. Never trust the frontend.
 */
import { z } from 'zod';

const clientType = z.enum(['individual', 'company', 'partner_customer']);
const clientStatus = z.enum(['active', 'inactive', 'blocked']);

// Moroccan identifiers are alphanumeric; keep permissive but bounded.
const optionalStr = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

export const CreateClientSchema = z.object({
  clientType: clientType.default('individual'),
  customerCode: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1, 'Le nom est requis').max(200),
  companyName: optionalStr(200),
  cin: optionalStr(30),
  ice: optionalStr(30),
  ifField: optionalStr(30),
  rc: optionalStr(30),
  vatNumber: optionalStr(40),
  email: z.string().trim().email('Email invalide').max(200).optional().or(z.literal('')),
  phone: optionalStr(40),
  phoneSecondary: optionalStr(40),
  contactName: optionalStr(120),
  address: optionalStr(2000),
  city: optionalStr(80),
  postalCode: optionalStr(20),
  country: optionalStr(80).default('MA'),
  creditLimit: z.number().min(0).max(1e12).optional(),
  paymentTerms: z.number().int().min(0).max(365).optional(),
  loyaltyDiscountPct: z.number().min(0).max(100).optional(),
  status: clientStatus.default('active'),
  notes: optionalStr(4000),
  // NEVER accept tenantId from client — stripped below.
}).strict().strip();

export const UpdateClientSchema = z.object({
  clientType: clientType.optional(),
  customerCode: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  companyName: optionalStr(200),
  cin: optionalStr(30),
  ice: optionalStr(30),
  ifField: optionalStr(30),
  rc: optionalStr(30),
  vatNumber: optionalStr(40),
  email: z.string().trim().email('Email invalide').max(200).optional().or(z.literal('')),
  phone: optionalStr(40),
  phoneSecondary: optionalStr(40),
  contactName: optionalStr(120),
  address: optionalStr(2000),
  city: optionalStr(80),
  postalCode: optionalStr(20),
  country: optionalStr(80),
  creditLimit: z.number().min(0).max(1e12).optional(),
  paymentTerms: z.number().int().min(0).max(365).optional(),
  loyaltyDiscountPct: z.number().min(0).max(100).optional(),
  status: clientStatus.optional(),
  notes: optionalStr(4000),
}).strict().strip();

export const ClientQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  clientType: clientType.optional(),
  status: clientStatus.optional(),
  sort: z.enum(['name', 'customerCode', 'createdAt', 'creditLimit', 'updatedAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// Reusable middleware guard: reject any tenant_id in body/query.
export const FORBIDDEN_CLIENT_KEYS = ['tenantId', 'tenant_id', 'createdBy', 'updatedBy'];
