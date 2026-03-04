// ---------------------------------------------------------------------------
// Generic provider HTTP routes — composed from domain-specific sub-routers
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { accountRoutes } from './accountRoutes.js';
import { bindingRoutes } from './bindingRoutes.js';
import { itemRoutes } from './itemRoutes.js';

export function providerRoutes(): Router {
  const router = Router();

  router.use(accountRoutes());
  router.use(bindingRoutes());
  router.use(itemRoutes());

  return router;
}
