/**
 * Browser E2E for the dashboard session wiring — no test framework, no deps.
 *
 * Uses Chrome over the DevTools Protocol (node 22+ global WebSocket) against a
 * STUB API, so the whole flow is verifiable without a database:
 *
 *   1. node tests/e2e/stub-api.mjs                       # :3002
 *   2. API_BASE_URL=http://localhost:3002 npm run build   # rewrite bakes at BUILD time
 *   3. npm run start -- --port 3101
 *   4. node tests/e2e/session-wiring.e2e.mjs
 *
 * The stub keys its /api/auth/me response off the token value, so each session
 * branch is reachable by setting a cookie: stub.valid / stub.expired /
 * stub.serverdown. CHROME below is machine-specific — adjust if needed.
 */
import { launch } from "./cdp-harness.mjs"

const WEB = "http://localhost:3101"
const SAM = "Sam Rivera"
const EMAIL = "sam@solosam.test"

let pass = 0, fail = 0
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log("  ok   " + name) }
  else { fail++; console.log("  FAIL " + name + (detail ? "  -> " + detail : "")) }
}

const b = await launch()
try {
  const text = () => b.evaluate("document.body.innerText")

  // ── A. login flow: form → API (via rewrite) → dashboard with real identity ──
  await b.goto(`${WEB}/login`)
  await b.evaluate(`
    (() => {
      const set = (sel, v) => {
        const el = document.querySelector(sel);
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('#email', '${EMAIL}');
      set('#password', 'correct-horse');
      document.querySelector('button[type=submit]').click();
      return true;
    })()
  `)
  check("A1 login navigates to /dashboard", await b.waitFor(`location.pathname === '/dashboard'`), await b.evaluate("location.pathname"))
  check("A2 session cookie set", await b.evaluate(`document.cookie.includes('ts_session=stub.valid')`), await b.evaluate("document.cookie"))
  check("A3 dashboard renders REAL display name", await b.waitFor(`document.body.innerText.includes('${SAM}')`), (await text()).slice(0, 200))
  check("A4 no fixture identity left behind", !(await text()).includes("Solo Sam\nSam"), "fixture TRADE_LABEL still rendering")

  // ── B. settings shows the live account ──
  await b.goto(`${WEB}/dashboard/settings`)
  check("B1 settings shows signed-in email", await b.waitFor(`document.body.innerText.includes('${EMAIL}')`), (await text()).slice(0, 300))
  check("B2 settings shows signed-in name", (await text()).includes(SAM))

  // ── C. expired token: gate bounces to /login and clears the cookie ──
  await b.goto(`${WEB}/dashboard`)
  await b.evaluate(`document.cookie = 'ts_session=stub.expired; path=/'`)
  await b.goto(`${WEB}/dashboard/settings`)
  check("C1 stale token redirects to /login", await b.waitFor(`location.pathname === '/login'`), await b.evaluate("location.pathname"))
  check("C2 dead cookie was cleared", await b.evaluate(`!document.cookie.includes('ts_session=stub.expired')`), await b.evaluate("document.cookie"))

  // ── D. server unconfigured: gate shows the error, fixture data never leaks ──
  await b.evaluate(`document.cookie = 'ts_session=stub.serverdown; path=/'`)
  await b.goto(`${WEB}/dashboard`)
  check("D1 gate surfaces the server error", await b.waitFor(`/load your schedule/.test(document.body.innerText)`), (await text()).slice(0, 200))
  const dText = await text()
  check("D2 no fixture schedule leaks while unverified", !dText.includes("Unconfirmed") && !dText.includes("Escalations"), dText.slice(0, 200))

  // ── E. sign out from settings returns to /login ──
  await b.evaluate(`document.cookie = 'ts_session=stub.valid; path=/'`)
  await b.goto(`${WEB}/dashboard/settings`)
  await b.waitFor(`document.body.innerText.includes('${SAM}')`)
  await b.evaluate(`
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sign out').click(); true
  `)
  check("E1 sign out returns to /login", await b.waitFor(`location.pathname === '/login'`), await b.evaluate("location.pathname"))
  check("E2 cookie cleared on sign out", await b.evaluate(`!document.cookie.includes('ts_session=stub.valid')`), await b.evaluate("document.cookie"))
} finally {
  b.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
