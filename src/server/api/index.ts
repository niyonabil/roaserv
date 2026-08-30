/**
 * ROA Services — API module mount (Auth + RBAC + business modules).
 * Mounted under /api in src/server.ts. Modules added progressively.
 */
import { Router } from 'express';
import { authRouter } from './auth.router';
import { rolesRouter } from './roles.router';
import { clientsRouter } from './clients.router';
import { stockRouter } from './stock.router';
import { machinesRouter } from './machines.router';
import { billingRouter } from './billing.router';
import { deliveryRouter } from './delivery.router';
import { affiliatesRouter } from './affiliates.router';
import { loginRateLimiter } from './rate-limit';

export const apiV1 = Router();

// Brute-force mitigation: rate-limit login attempts (IP+username, 5/15min -> 429).
// Mounted BEFORE the auth router so it guards POST /api/auth/login.
apiV1.use('/auth/login', loginRateLimiter);

apiV1.use('/auth', authRouter);
apiV1.use('/', rolesRouter); // /roles, /permissions, /users/:id/roles, /me
apiV1.use('/', clientsRouter); // /clients CRUD (tenant-scoped + RBAC)
apiV1.use('/', stockRouter); // /stock, /stock/movements, /stock/alerts (tenant-scoped + RBAC)
apiV1.use('/', machinesRouter); // /machines, /machines/:id/counters|maintenance, /machines/estimate (tenant-scoped + RBAC)
apiV1.use('/', billingRouter); // /quotes, /invoices, /payments CRUD + items/refunds (tenant-scoped + RBAC)
apiV1.use('/', deliveryRouter); // /deliveries + attempts (tenant-scoped + RBAC)
apiV1.use('/', affiliatesRouter); // /affiliates + referrals/commissions (tenant-scoped + RBAC)
