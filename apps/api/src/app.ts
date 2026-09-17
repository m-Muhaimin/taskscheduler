import express from 'express';

/**
 * Express app factory. Kept separate from the bootstrap (index.ts) so tests
 * and the worker process can import the same app. No env-dependent clients
 * are constructed here — the server must boot cleanly with no .env present.
 */
export function createApp(): express.Express {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
