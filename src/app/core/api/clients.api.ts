/**
 * ROA Services — Frontend HTTP layer for the new architecture (Phase 2).
 *
 * Talks to the JWT/RBAC/tenant-scoped backend mounted under /api/v1.
 * The legacy monolithic screens (data.ts) keep using the /api legacy routes.
 * This module is the bridge for the Clients screen: it authenticates against
 * /api/auth/login and lists clients from /api/v1/clients with the access token.
 *
 * Auth contract (verified against src/server/api/auth.service.ts + auth.router.ts):
 *   POST /api/v1/auth/login  { identifier, password }
 *     -> { success: true, data: { accessToken, refreshToken, expiresIn, user: { id, tenantId, perms, roles } } }
 *   GET  /api/v1/clients  (Authorization: Bearer <accessToken>)
 *     -> { success: true, data: { data: ClientApi[], page, pageSize, total, totalPages } }
 */

export interface ApiUser {
  id: string;
  tenantId: string;
  perms: string[];
  roles: string[];
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: ApiUser;
}

/** Shape returned by GET /api/v1/clients (matches the `client` table columns). */
export interface ClientApi {
  id: string;
  tenantId: string;
  clientType: 'individual' | 'company' | 'partner_customer';
  customerCode?: string | null;
  name: string;
  cin?: string | null;
  ice?: string | null;
  if?: string | null;
  rc?: string | null;
  vatNumber?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  phoneSecondary?: string | null;
  contactName?: string | null;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string;
  creditLimit?: string | number;
  paymentTerms?: number;
  outstandingBalance?: string | number;
  loyaltyDiscountPct?: string | number;
  status?: 'active' | 'inactive' | 'blocked';
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClientsPage {
  data: ClientApi[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const TOKEN_KEY = 'roaserv_access_token';
const USER_KEY = 'roaserv_user';

function resolveBaseUrl(): string {
  // On server (SSR) the relative URL cannot be fetched directly; callers run in browser.
  return '';
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = token ?? getStoredToken();
  if (t) headers['Authorization'] = `Bearer ${t}`;
  return headers;
}

export function getStoredToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): ApiUser | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ApiUser;
  } catch {
    return null;
  }
}

export function storeAuth(result: LoginResult): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, result.accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(result.user));
}

export function clearAuth(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * Authenticate against the new backend and persist the JWT.
 * @returns the login result (token + user with perms/tenantId)
 * @throws Error with the backend message on failure
 */
export async function login(identifier: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const text = await res.text();
  let payload: any = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
    }
  }
  if (!res.ok) {
    const msg = (payload && (payload.error as string)) || `Erreur de connexion (${res.status})`;
    throw new Error(msg);
  }
  // Backend wraps the payload in { success, data }
  const data: LoginResult = payload.data ?? payload;
  if (!data || !data.accessToken) {
    throw new Error('Réponse de connexion invalide (jeton manquant).');
  }
  storeAuth(data);
  return data;
}

/**
 * Fetch the tenants clients from the new backend, paginated + filtered.
 * Uses the stored JWT automatically; pass `token` to override.
 */
export async function listClients(opts?: {
  page?: number;
  pageSize?: number;
  search?: string;
  clientType?: string;
  status?: string;
  sort?: string;
  order?: string;
  token?: string;
}): Promise<ClientsPage> {
  const params = new URLSearchParams();
  if (opts?.page) params.set('page', String(opts.page));
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts?.search) params.set('search', opts.search);
  if (opts?.clientType) params.set('clientType', opts.clientType);
  if (opts?.status) params.set('status', opts.status);
  if (opts?.sort) params.set('sort', opts.sort);
  if (opts?.order) params.set('order', opts.order);
  const qs = params.toString();
  const res = await fetch(`${resolveBaseUrl()}/api/v1/clients${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    headers: authHeaders(opts?.token),
  });
  const text = await res.text();
  let payload: any = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
    }
  }
  if (!res.ok) {
    const msg = (payload && (payload.error as string)) || `Erreur HTTP ${res.status}`;
    throw new Error(msg);
  }
  return (payload.data ?? payload) as ClientsPage;
}
