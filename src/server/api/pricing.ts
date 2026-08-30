/**
 * ROA Services — clean, self-contained print-job price estimation.
 *
 * Exported as a pure function (no DB access) so it can be unit-tested and
 * reused from the Machines module endpoint. This replaces the legacy
 * `computePrintJobPrice` in src/server.ts which depended on Firebase-era
 * types (PrintJob / PrintPricingConfig / PrintMaterial) and is not part of
 * the new Drizzle architecture.
 *
 * Pricing model (transparent, tenant-agnostic defaults):
 *   estimatedCost  = machineCost + paperMaterialCost + finishingCost
 *   salePrice      = estimatedCost * (1 + baseMargin) * urgencyMultiplier
 *   estimatedProfit= salePrice - estimatedCost
 */

export interface JobEstimateInput {
  machineId?: string;
  pages: number;
  copies?: number;
  color?: boolean;
  duplex?: boolean;
  format?: 'A4' | 'A3' | 'A5';
  paperType?: string;
  finishingOptions?: string[];
  urgencyKey?: string;
}

export interface JobEstimateResult {
  salePrice: number;
  estimatedCost: number;
  estimatedProfit: number;
  marginPercent: number;
  details: Record<string, number>;
}

const URGENCY_MULTIPLIERS: Record<string, number> = {
  normal: 1,
  fast: 1.3,
  urgent: 1.6,
  very_urgent: 2.0,
};

const BASE_MARGIN = 0.3; // 30%
const FINISHING_UNIT_COST = 0.8; // per finishing option per copy

export interface ComputeOpts {
  /** Effective machine cost per page (from machine_cost matrix or machine.costPerPage). */
  costPerPage?: number | null;
  /** Effective paper unit cost per sheet (optional, from stock). */
  materialUnitCost?: number | null;
}

export function computePrintJobPrice(input: JobEstimateInput, opts: ComputeOpts = {}): JobEstimateResult {
  const pages = Math.max(0, Math.floor(input.pages) || 0);
  const copies = Math.max(1, Math.floor(input.copies ?? 1));
  const color = !!input.color;
  const duplex = !!input.duplex;
  const fmt = (input.format || 'A4').toUpperCase() as 'A4' | 'A3' | 'A5';
  const totalPages = pages * copies;

  const baseMachineCost = Number(opts.costPerPage ?? 0) > 0 ? Number(opts.costPerPage) : (color ? 0.65 : 0.12);
  const sheetFactor = duplex ? 0.55 : 1; // duplex saves ~45% of sheets
  const paperUnitCost = opts.materialUnitCost != null ? Number(opts.materialUnitCost)
    : (input.paperType === 'standard_80g' ? 0.042 : 0.09);

  const machineCost = round2(totalPages * baseMachineCost);
  const materialCost = round2(totalPages * paperUnitCost * sheetFactor);
  const finishingCost = round2(copies * (input.finishingOptions?.length ?? 0) * FINISHING_UNIT_COST);
  const estimatedCost = round2(machineCost + materialCost + finishingCost);

  const urgencyMult = URGENCY_MULTIPLIERS[String(input.urgencyKey || 'normal').toLowerCase()] ?? 1;
  const salePrice = round2(estimatedCost * (1 + BASE_MARGIN) * urgencyMult);
  const estimatedProfit = round2(salePrice - estimatedCost);
  const marginPercent = salePrice > 0 ? round1((estimatedProfit / salePrice) * 100) : 0;

  return {
    salePrice,
    estimatedCost,
    estimatedProfit,
    marginPercent,
    details: {
      totalPages,
      costPerPage: round2(baseMachineCost),
      machineCost,
      materialCost,
      finishingCost,
      urgencyMultiplier: urgencyMult,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
