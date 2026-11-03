import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { notFound, type Core } from '@atlas/core';
import { errorHandler, loadUser, sameOrigin } from './middleware';
import { authRouter } from './routes/auth';
import { evalRunsRouter } from './routes/evalRuns';
import { workspacesRouter } from './routes/workspaces';

export function createApp(core: Core, logger: Logger): Express {
  const app = express();
  app.disable('x-powered-by');
  // headers that tell a browser not to sniff types, frame the API or send referrers; the API serves JSON and
  // downloads, never pages, so the strict defaults cost nothing
  app.use(helmet());
  // behind the Next.js proxy and any load balancer, the client address is in X-Forwarded-For
  app.set('trust proxy', core.config.TRUST_PROXY_HOPS);

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());
  app.use(sameOrigin(core.config.SITE_ORIGIN));
  app.use(loadUser(core));

  app.get('/health', async (_req, res) => {
    const mongo = await core.database.db.command({ ping: 1 }).then(
      () => true,
      () => false,
    );
    res.status(mongo ? 200 : 503).json({ ok: mongo, mongo });
  });

  app.use('/auth', authRouter(core));
  app.use('/eval/runs', evalRunsRouter(core));
  app.use('/workspaces', workspacesRouter(core));

  app.use((_req, _res, next) => next(notFound('That page')));
  app.use(errorHandler(logger));
  return app;
}
