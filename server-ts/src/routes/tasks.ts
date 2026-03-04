import { Router } from 'express';

import { taskCrudRoutes } from './taskCrud.js';
import { taskSyncRoutes } from './taskSync.js';

export function taskRoutes(): Router {
  const router = Router();
  router.use(taskSyncRoutes());
  router.use(taskCrudRoutes());
  return router;
}
