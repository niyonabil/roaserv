import { Router } from 'express';
import { loginRateLimiter } from './rate-limit';
import { authRouter } from './auth.router';
import { rolesRouter } from './roles.router';
import { clientsRouter } from './clients.router';
import { stockRouter } from './stock.router';
import { machinesRouter } from './machines.router';
import { billingRouter } from './billing.router';
import { deliveryRouter } from './delivery.router';
import { affiliatesRouter } from './affiliates.router';

/** Crée une instance fraîche du routeur apiV1 (montage multi-prefix safe) */
export function createApiV1() {
  const r = Router();
  r.use('/auth/login', loginRateLimiter);
  r.use('/auth', authRouter);
  r.use('/', rolesRouter);
  r.use('/', clientsRouter);
  r.use('/', stockRouter);
  r.use('/', machinesRouter);
  r.use('/', billingRouter);
  r.use('/', deliveryRouter);
  r.use('/', affiliatesRouter);
  return r;
}

/** Instance par défaut (compat imports existants) */
export const apiV1 = createApiV1();
