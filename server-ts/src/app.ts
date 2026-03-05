import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';

import type { AppState } from './state.js';
import { ApiError } from './errors.js';

import { healthRoutes } from './routes/health.js';
import { repoRoutes } from './routes/repos.js';
import { taskRoutes } from './routes/tasks.js';
import { taskPipelineRoutes } from './routes/taskPipeline.js';
import { planRoutes } from './routes/plans.js';
import { planJobRoutes } from './routes/planJobs.js';
import { planReviewRoutes } from './routes/planReview.js';
import { runRoutes } from './routes/runs.js';
import { reviewRoutes } from './routes/reviews.js';
import { agentRoutes } from './routes/agents.js';
import { chatRoutes } from './routes/chat.js';
import { rulesRoutes } from './routes/rules.js';
import { fsRoutes } from './routes/fs.js';
import { providerRoutes } from './provider/routes.js';
import { cloudwatchRoutes } from './provider/cloudwatch/routes.js';
import { elasticsearchRoutes } from './provider/elasticsearch/routes.js';
import { sonarqubeRoutes } from './provider/sonarqube/routes.js';
import { memoryRoutes } from './routes/memories.js';

export function createApp(state: AppState): express.Express {
  const app = express();

  // CORS — allow everything (matches Rust CorsLayer::new().allow_origin(Any)...)
  app.use(cors());

  // Parse JSON bodies
  app.use(express.json({ limit: '10mb' }));

  // Inject state into app.locals
  app.locals.state = state;

  // Mount all route groups
  app.use(healthRoutes());
  app.use(repoRoutes());
  app.use(taskRoutes());
  app.use(taskPipelineRoutes());
  app.use(planRoutes());
  app.use(planJobRoutes());
  app.use(planReviewRoutes());
  app.use(runRoutes());
  app.use(reviewRoutes());
  app.use(agentRoutes());
  app.use(chatRoutes());
  app.use(rulesRoutes());
  app.use(fsRoutes());
  app.use(providerRoutes());
  app.use(cloudwatchRoutes());
  app.use(elasticsearchRoutes());
  app.use(sonarqubeRoutes());
  app.use(memoryRoutes());

  // Global error handler — catches unhandled sync throws and async rejections
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      err.toResponse(res);
    } else {
      ApiError.internal(err).toResponse(res);
    }
  });

  return app;
}
