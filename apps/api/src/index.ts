import './env.js';
import { createApp } from './app.js';

const app = createApp();
const PORT = Number(process.env.PORT ?? 3001);

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});
