/**
 * Boot-time env loader (local dev).
 *
 * The API ships no dotenv dependency: Node's built-in process.loadEnvFile
 * reads the gitignored repo-root .env BEFORE the app/worker modules
 * evaluate. Existing process.env values are never overridden.
 *
 * Absent or unreadable .env is fine — the server must boot clean with no
 * .env present (env-free boot rule; CI/prod inject their own env).
 */
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // no .env — rely on injected environment
}
