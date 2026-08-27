/**
 * ROA Services — Multi-tenant PostgreSQL schema (Drizzle ORM).
 *
 * INVARIANT: every business table carries `tenantId` (FK -> tenant.id).
 * Repository layer enforces tenant scoping on every query (fail-closed).
 * No cross-tenant access is possible by construction.
 *
 * Auth model (per approved architecture):
 *  - Identity: app-issued JWT (no Firebase dependency in this build).
 *  - passwordHash: bcrypt. Session: short-lived access + refresh token.
 *  - Authorization: RBAC via role <-> permission verbs; one user = many roles.
 */
import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  bigint,
  numeric,
  boolean,
  jsonb,
  timestamp,
  date,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const now = () => sql`now()`;

/* ----------------------------- Enums ----------------------------- */
export const clientTypeEnum = pgEnum('client_type', ['individual', 'company', 'partner_customer']);
export const serviceItemTypeEnum = pgEnum('service_item_type', ['digital', 'physical']);
export const paymentTypeEnum = pgEnum('payment_type', ['deposit', 'solde', 'partial', 'full']);
export const paymentMethodEnum = pgEnum('payment_method', ['cash', 'transfer', 'card', 'online', 'mobile', 'other']);
export const stockMovementTypeEnum = pgEnum('stock_movement_type', [
  'in', 'purchase', 'consumption', 'reservation', 'reservation_release',
  'adjustment', 'waste', 'return', 'transfer',
]);
export const maintenanceTypeEnum = pgEnum('maintenance_type', ['preventive', 'corrective', 'breakdown']);
export const commissionStatusEnum = pgEnum('commission_status', ['pending', 'approved', 'paid', 'cancelled']);
export const deliveryStatusEnum = pgEnum('delivery_status', ['a_preparer', 'en_livraison', 'echec', 'nouvelle_tentative', 'livree']);
export const reservationStatusEnum = pgEnum('reservation_status', ['active', 'released']);
export const userStatusEnum = pgEnum('user_status', ['active', 'inactive', 'locked', 'pending']);
export const clientStatusEnum = pgEnum('client_status', ['active', 'inactive', 'blocked']);
export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended', 'trial']);
export const invoiceStatusEnum = pgEnum('invoice_status', ['draft', 'sent', 'paid', 'partial', 'overdue', 'cancelled']);
export const poStatusEnum = pgEnum('po_status', ['draft', 'sent', 'received', 'cancelled']);

/* ----------------------------- Tenant ----------------------------- */
export const tenant = pgTable('tenant', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  slug: varchar('slug', { length: 120 }).notNull().unique(),
  subscriptionTier: varchar('subscription_tier', { length: 40 }).notNull().default('trial'),
  status: tenantStatusEnum('status').notNull().default('trial'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ----------------------- Permissions & Roles ----------------------- */
export const permission = pgTable('permission', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 80 }).notNull().unique(), // e.g. manage_stock
  description: text('description'),
});

export const role = pgTable('role', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  isCustom: boolean('is_custom').notNull().default(false),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqTenantRole: uniqueIndex('uniq_tenant_role').on(t.tenantId, t.name),
}));

export const rolePermission = pgTable('role_permission', {
  roleId: uuid('role_id').notNull().references(() => role.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permission.id, { onDelete: 'cascade' }),
}, (t) => ({ pk: primaryKey({ columns: [t.roleId, t.permissionId] }) }));

/* ----------------------------- Users ----------------------------- */
export const user = pgTable('app_user', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 200 }).notNull(),
  username: varchar('username', { length: 100 }).notNull(),
  passwordHash: varchar('password_hash', { length: 100 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  phone: varchar('phone', { length: 40 }),
  status: userStatusEnum('status').notNull().default('active'),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  emailVerified: boolean('email_verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqTenantEmail: uniqueIndex('uniq_tenant_email').on(t.tenantId, t.email),
  uniqTenantUsername: uniqueIndex('uniq_tenant_username').on(t.tenantId, t.username),
}));

export const userRole = pgTable('user_role', {
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => role.id, { onDelete: 'cascade' }),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.roleId] }) }));

/** Refresh tokens (opaque, stored hashed) — server-side session state. */
export const refreshToken = pgTable('refresh_token', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 100 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Login / security event history (tenant-scoped where applicable). */
export const authEvent = pgTable('auth_event', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenant.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 40 }).notNull(), // login_success|login_fail|lockout|logout|password_reset
  ip: varchar('ip', { length: 45 }),
  userAgent: text('user_agent'),
  detail: text('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ idxTenant: index('idx_auth_event_tenant').on(t.tenantId) }));

/* ----------------------------- Clients ----------------------------- */
export const client = pgTable('client', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  clientType: clientTypeEnum('client_type').notNull().default('individual'),
  customerCode: varchar('customer_code', { length: 40 }),
  name: varchar('name', { length: 200 }).notNull(),
  cin: varchar('cin', { length: 30 }),
  ice: varchar('ice', { length: 30 }),
  if: varchar('if_field', { length: 30 }),
  rc: varchar('rc', { length: 30 }),
  vatNumber: varchar('vat_number', { length: 40 }),
  companyName: varchar('company_name', { length: 200 }),
  email: varchar('email', { length: 200 }),
  phone: varchar('phone', { length: 40 }),
  phoneSecondary: varchar('phone_secondary', { length: 40 }),
  contactName: varchar('contact_name', { length: 120 }),
  address: text('address'),
  city: varchar('city', { length: 80 }),
  postalCode: varchar('postal_code', { length: 20 }),
  country: varchar('country', { length: 80 }).notNull().default('MA'),
  creditLimit: numeric('credit_limit', { precision: 12, scale: 2 }).notNull().default('0'),
  paymentTerms: integer('payment_terms').notNull().default(30), // days
  outstandingBalance: numeric('outstanding_balance', { precision: 12, scale: 2 }).notNull().default('0'),
  loyaltyDiscountPct: numeric('loyalty_discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  status: clientStatusEnum('status').notNull().default('active'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ idxTenant: index('idx_client_tenant').on(t.tenantId), uniqTenantCode: uniqueIndex('uniq_tenant_customer_code').on(t.tenantId, t.customerCode) }));

export const clientContact = pgTable('client_contact', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull().references(() => client.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  email: varchar('email', { length: 200 }),
  phone: varchar('phone', { length: 40 }),
  role: varchar('role', { length: 80 }),
});

/* ----------------------- Catalog & Pricing ----------------------- */
export const serviceCatalog = pgTable('service_catalog', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  category: varchar('category', { length: 60 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  itemType: serviceItemTypeEnum('item_type').notNull().default('physical'),
  basePrice: numeric('base_price', { precision: 12, scale: 2 }).notNull().default('0'),
  unit: varchar('unit', { length: 30 }).notNull().default('unit'),
  isActive: boolean('is_active').notNull().default(true),
});

/** Per-machine cost/selling matrix (V1 requirement: per-machine, not global). */
export const machineCost = pgTable('machine_cost', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  machineId: uuid('machine_id').notNull().references(() => machine.id, { onDelete: 'cascade' }),
  format: varchar('format', { length: 10 }).notNull(), // A4|A3|A5
  color: boolean('color').notNull().default(false),
  sides: varchar('sides', { length: 10 }).notNull().default('simplex'), // simplex|duplex
  costPerPage: numeric('cost_per_page', { precision: 10, scale: 4 }).notNull(),
  sellingPerPage: numeric('selling_per_page', { precision: 10, scale: 4 }).notNull(),
});

export const pricingConfig = pgTable('pricing_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 60 }).notNull(), // urgency_multiplier|volume_discount|vat|deposit
  value: jsonb('value').notNull(),
}, (t) => ({ uniq: uniqueIndex('uniq_pricing_config').on(t.tenantId, t.key) }));

/* ----------------------- Projects / Orders ----------------------- */
export const project = pgTable('project', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  reference: varchar('reference', { length: 40 }).notNull(),
  clientId: uuid('client_id').notNull().references(() => client.id, { onDelete: 'restrict' }),
  affiliateId: uuid('affiliate_id').references(() => affiliate.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 40 }).notNull().default('nouvelle_demande'),
  createdBy: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqRef: uniqueIndex('uniq_project_ref').on(t.tenantId, t.reference) }));

export const serviceItem = pgTable('service_item', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  catalogId: uuid('catalog_id').references(() => serviceCatalog.id, { onDelete: 'set null' }),
  itemType: serviceItemTypeEnum('item_type').notNull().default('physical'),
  label: varchar('label', { length: 200 }).notNull(),
  specs: jsonb('specs'),
  quantity: integer('quantity').notNull().default(1),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull().default('0'),
  cost: numeric('cost', { precision: 12, scale: 2 }).notNull().default('0'),
  margin: numeric('margin', { precision: 12, scale: 2 }).notNull().default('0'),
});

export const jobStatusHistory = pgTable('job_status_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  fromStatus: varchar('from_status', { length: 40 }),
  toStatus: varchar('to_status', { length: 40 }).notNull(),
  changedBy: uuid('changed_by').references(() => user.id, { onDelete: 'set null' }),
  comment: text('comment'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ----------------------- Production Jobs ----------------------- */
export const productionJob = pgTable('production_job', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  serviceItemId: uuid('service_item_id').references(() => serviceItem.id, { onDelete: 'set null' }),
  machineId: uuid('machine_id').references(() => machine.id, { onDelete: 'set null' }),
  operatorId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 40 }).notNull().default('nouveau'),
  priority: varchar('priority', { length: 20 }).notNull().default('normal'),
  deadline: date('deadline'),
  plannedConsumption: jsonb('planned_consumption'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ idxStatus: index('idx_job_status_tenant').on(t.tenantId, t.status) }));

/* ----------------------- Machines & Maintenance ----------------------- */
export const machine = pgTable('machine', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 40 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  brand: varchar('brand', { length: 100 }),
  model: varchar('model', { length: 100 }),
  serial: varchar('serial', { length: 120 }),
  type: varchar('type', { length: 60 }),
  location: varchar('location', { length: 120 }),
  status: varchar('status', { length: 30 }).notNull().default('active'),
  costPerPage: numeric('cost_per_page', { precision: 10, scale: 4 }).notNull().default('0'),
  acquisitionDate: date('acquisition_date'),
  acquisitionCost: numeric('acquisition_cost', { precision: 12, scale: 2 }),
  warrantyUntil: date('warranty_until'),
  supplier: varchar('supplier', { length: 150 }),
  nextMaintenance: date('next_maintenance'),
  assignedOperatorId: uuid('assigned_operator_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => ({ uniqCode: uniqueIndex('uniq_machine_code').on(t.tenantId, t.code) }));

export const machineCounter = pgTable('machine_counter', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  machineId: uuid('machine_id').notNull().references(() => machine.id, { onDelete: 'cascade' }),
  bwCount: bigint('bw_count', { mode: 'number' }).notNull().default(0),
  colorCount: bigint('color_count', { mode: 'number' }).notNull().default(0),
  a4Count: bigint('a4_count', { mode: 'number' }).notNull().default(0),
  a3Count: bigint('a3_count', { mode: 'number' }).notNull().default(0),
  readAt: date('read_at').notNull(),
});

export const maintenance = pgTable('maintenance', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  machineId: uuid('machine_id').notNull().references(() => machine.id, { onDelete: 'cascade' }),
  type: maintenanceTypeEnum('type').notNull(),
  doneBy: uuid('done_by').references(() => user.id, { onDelete: 'set null' }),
  cost: numeric('cost', { precision: 12, scale: 2 }).notNull().default('0'),
  downtimeMin: integer('downtime_min').notNull().default(0),
  notes: text('notes'),
  performedAt: date('performed_at').notNull(),
});

/* ----------------------- Stock & Consumables ----------------------- */
export const material = pgTable('material', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  sku: varchar('sku', { length: 60 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  category: varchar('category', { length: 60 }).notNull(),
  unit: varchar('unit', { length: 20 }).notNull().default('pcs'),
  qtyOnHand: numeric('qty_on_hand', { precision: 14, scale: 3 }).notNull().default('0'),
  qtyReserved: numeric('qty_reserved', { precision: 14, scale: 3 }).notNull().default('0'),
  min: numeric('min_qty', { precision: 14, scale: 3 }).notNull().default('0'),
  max: numeric('max_qty', { precision: 14, scale: 3 }),
  reorderLevel: numeric('reorder_level', { precision: 14, scale: 3 }),
  preferredSupplierId: uuid('preferred_supplier_id').references(() => supplier.id, { onDelete: 'set null' }),
  unitCost: numeric('unit_cost', { precision: 12, scale: 4 }).notNull().default('0'),
}, (t) => ({ uniqSku: uniqueIndex('uniq_material_sku').on(t.tenantId, t.sku) }));

export const batch = pgTable('batch', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  materialId: uuid('material_id').notNull().references(() => material.id, { onDelete: 'cascade' }),
  lotNumber: varchar('lot_number', { length: 80 }),
  serial: varchar('serial', { length: 120 }),
  expiry: date('expiry'),
  qty: numeric('qty', { precision: 14, scale: 3 }).notNull(),
});

export const stockMovement = pgTable('stock_movement', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  materialId: uuid('material_id').notNull().references(() => material.id, { onDelete: 'cascade' }),
  type: stockMovementTypeEnum('type').notNull(),
  qty: numeric('qty', { precision: 14, scale: 3 }).notNull(),
  jobId: uuid('job_id').references(() => productionJob.id, { onDelete: 'set null' }),
  reason: text('reason'),
  createdBy: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ idxMat: index('idx_stock_movement_material').on(t.tenantId, t.materialId) }));

export const stockReservation = pgTable('stock_reservation', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  materialId: uuid('material_id').notNull().references(() => material.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').notNull().references(() => productionJob.id, { onDelete: 'cascade' }),
  qty: numeric('qty', { precision: 14, scale: 3 }).notNull(),
  status: reservationStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ----------------------- Suppliers & Purchases ----------------------- */
export const supplier = pgTable('supplier', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  contact: text('contact'),
  email: varchar('email', { length: 200 }),
  phone: varchar('phone', { length: 40 }),
});

export const purchaseOrder = pgTable('purchase_order', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').notNull().references(() => supplier.id, { onDelete: 'restrict' }),
  reference: varchar('reference', { length: 40 }).notNull(),
  status: poStatusEnum('status').notNull().default('draft'),
  total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqRef: uniqueIndex('uniq_po_ref').on(t.tenantId, t.reference) }));

export const purchaseOrderLine = pgTable('purchase_order_line', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  poId: uuid('po_id').notNull().references(() => purchaseOrder.id, { onDelete: 'cascade' }),
  materialId: uuid('material_id').notNull().references(() => material.id, { onDelete: 'restrict' }),
  qty: numeric('qty', { precision: 14, scale: 3 }).notNull(),
  unitCost: numeric('unit_cost', { precision: 12, scale: 4 }).notNull(),
});

export const purchaseReceipt = pgTable('purchase_receipt', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  poId: uuid('po_id').notNull().references(() => purchaseOrder.id, { onDelete: 'cascade' }),
  receivedAt: date('received_at').notNull(),
});

/* ----------------------- Billing ----------------------- */
export const quotation = pgTable('quotation', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 30 }).notNull().default('draft'),
  depositPct: numeric('deposit_pct', { precision: 5, scale: 2 }).notNull().default('50'),
  totalHt: numeric('total_ht', { precision: 14, scale: 2 }).notNull().default('0'),
  vat: numeric('vat', { precision: 14, scale: 2 }).notNull().default('0'),
  totalTtc: numeric('total_ttc', { precision: 14, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoice = pgTable('invoice', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  number: varchar('number', { length: 40 }).notNull(),
  status: invoiceStatusEnum('status').notNull().default('draft'),
  ht: numeric('ht', { precision: 14, scale: 2 }).notNull().default('0'),
  vat: numeric('vat', { precision: 14, scale: 2 }).notNull().default('0'),
  ttc: numeric('ttc', { precision: 14, scale: 2 }).notNull().default('0'),
  dueDate: date('due_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqNum: uniqueIndex('uniq_invoice_num').on(t.tenantId, t.number) }));

export const invoiceLine = pgTable('invoice_line', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  invoiceId: uuid('invoice_id').notNull().references(() => invoice.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 200 }).notNull(),
  ht: numeric('ht', { precision: 14, scale: 2 }).notNull().default('0'),
  vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('20'),
  ttc: numeric('ttc', { precision: 14, scale: 2 }).notNull().default('0'),
});

export const payment = pgTable('payment', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull().references(() => client.id, { onDelete: 'restrict' }),
  invoiceId: uuid('invoice_id').references(() => invoice.id, { onDelete: 'set null' }),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  method: paymentMethodEnum('method').notNull().default('cash'),
  type: paymentTypeEnum('type').notNull().default('partial'),
  reversalOf: uuid('reversal_of').references((): any => payment.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ idxClient: index('idx_payment_client').on(t.tenantId, t.clientId) }));

export const refund = pgTable('refund', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  paymentId: uuid('payment_id').notNull().references(() => payment.id, { onDelete: 'restrict' }),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const creditNote = pgTable('credit_note', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull().references(() => client.id, { onDelete: 'restrict' }),
  invoiceId: uuid('invoice_id').references(() => invoice.id, { onDelete: 'set null' }),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ----------------------- Files ----------------------- */
export const fileAsset = pgTable('file_asset', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').references(() => client.id, { onDelete: 'set null' }),
  projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),
  serviceItemId: uuid('service_item_id').references(() => serviceItem.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 255 }).notNull(),
  mime: varchar('mime', { length: 100 }),
  size: bigint('size', { mode: 'number' }).notNull().default(0),
  storageProvider: varchar('storage_provider', { length: 40 }).notNull().default('s3'),
  storageKey: varchar('storage_key', { length: 400 }).notNull(),
  checksum: varchar('checksum', { length: 128 }),
  currentVersion: integer('current_version').notNull().default(1),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  uploadedBy: uuid('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fileVersion = pgTable('file_version', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  fileAssetId: uuid('file_asset_id').notNull().references(() => fileAsset.id, { onDelete: 'cascade' }),
  version: varchar('version', { length: 20 }).notNull(),
  storageKey: varchar('storage_key', { length: 400 }).notNull(),
  uploadedBy: uuid('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ----------------------- Affiliates ----------------------- */
export const affiliate = pgTable('affiliate', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 40 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  referralLink: varchar('referral_link', { length: 400 }),
  qrCode: varchar('qr_code', { length: 400 }),
  commissionModel: varchar('commission_model', { length: 30 }).notNull().default('percentage'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqCode: uniqueIndex('uniq_affiliate_code').on(t.tenantId, t.code) }));

export const affiliateReferral = pgTable('affiliate_referral', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  affiliateId: uuid('affiliate_id').notNull().references(() => affiliate.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull().references(() => client.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),
  orderValue: numeric('order_value', { precision: 14, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const commission = pgTable('commission', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  affiliateId: uuid('affiliate_id').notNull().references(() => affiliate.id, { onDelete: 'cascade' }),
  referralId: uuid('referral_id').references(() => affiliateReferral.id, { onDelete: 'set null' }),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  status: commissionStatusEnum('status').notNull().default('pending'),
  ruleType: varchar('rule_type', { length: 30 }).notNull().default('percentage'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const commissionPayout = pgTable('commission_payout', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  affiliateId: uuid('affiliate_id').notNull().references(() => affiliate.id, { onDelete: 'cascade' }),
  total: numeric('total', { precision: 14, scale: 2 }).notNull(),
  paidAt: date('paid_at').notNull(),
});

/* ----------------------- Delivery ----------------------- */
export const delivery = pgTable('delivery', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  mode: varchar('mode', { length: 20 }).notNull().default('local'), // pickup|local|home
  driverId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
  address: text('address'),
  city: varchar('city', { length: 80 }),
  phone: varchar('phone', { length: 40 }),
  fees: numeric('fees', { precision: 10, scale: 2 }).notNull().default('0'),
  status: deliveryStatusEnum('status').notNull().default('a_preparer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deliveryAttempt = pgTable('delivery_attempt', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  deliveryId: uuid('delivery_id').notNull().references(() => delivery.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).notNull(), // success|fail
  reason: text('reason'),
  cost: numeric('cost', { precision: 10, scale: 2 }),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ----------------------- Notifications & Config ----------------------- */
export const notification = pgTable('notification', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  recipientId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
  channel: varchar('channel', { length: 20 }).notNull().default('in_app'),
  type: varchar('type', { length: 60 }).notNull(),
  payload: jsonb('payload'),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notificationRule = pgTable('notification_rule', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  event: varchar('event', { length: 60 }).notNull(),
  recipientRoles: jsonb('recipient_roles').notNull().default([]),
  channels: jsonb('channels').notNull().default(['in_app']),
});

export const config = pgTable('config', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 60 }).notNull(),
  value: jsonb('value').notNull(),
}, (t) => ({ uniq: uniqueIndex('uniq_config').on(t.tenantId, t.key) }));

/* ----------------------- Audit ----------------------- */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenant.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 60 }).notNull(),
  entity: varchar('entity', { length: 60 }).notNull(),
  entityId: uuid('entity_id'),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  ip: varchar('ip', { length: 45 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ idxEntity: index('idx_audit_entity').on(t.entity, t.entityId) }));
