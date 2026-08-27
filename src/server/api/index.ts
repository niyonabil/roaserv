/**
 * ROA Services — API module mount (Auth + RBAC + business modules).
 * Mounted under /api in src/server.ts. Modules added progressively.
 */
import { Router } from 'express';
import { authRouter } from './auth.router';
import { rolesRouter } from './roles.router';
import { clientsRouter } from './clients.router';

export const apiV1 = Router();
apiV1.use('/auth', authRouter);
apiV1.use('/', rolesRouter); // /roles, /permissions, /users/:id/roles, /me
apiV1.use('/', clientsRouter); // /clients CRUD (tenant-scoped + RBAC)
