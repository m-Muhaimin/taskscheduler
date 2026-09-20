import express from 'express';
import { twilioWebhooksRouter } from './routes/twilio-webhooks.js';
import { authRouter } from './routes/auth.js';
import { googleOauthRouter } from './routes/google-oauth.js';
import { mountDashboardRoutes } from './routes/dashboard/index.js';
import { assistantRouter } from './routes/assistant.js';

/** Express app factory. Kept separate from the bootstrap (index.ts) so tests
 *  and the worker process can import the same app. No env-dependent clients
 *  are constructed here — the server must boot cleanly with no .env present.
 */
export function createApp(): express.Express {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.use('/api/auth/google', googleOauthRouter); // must precede /api/auth
  app.use('/api/auth', authRouter);
  app.use('/api/twilio/webhooks', twilioWebhooksRouter);
  mountDashboardRoutes(app);
  app.use('/api/assistant', assistantRouter); // before the health route / any fallthrough

  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
