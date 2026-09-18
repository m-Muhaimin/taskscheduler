import assert from "node:assert/strict"
const { resolveSession } = (await import("../src/lib/session-core")) as typeof import("../src/lib/session-core")

const USER = { id: "u1", email: "sam@example.com", displayName: "Sam" }
let seenAuth: string | null = null

function fakeFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seenAuth = new Headers(init?.headers).get("authorization")
    return handler(url)
  }) as unknown as typeof fetch
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

let pass = 0
async function check(name: string, fn: () => Promise<void>) {
  await fn()
  pass++
  console.log("  ok  " + name)
}

await check("no token -> unauthenticated (no request made)", async () => {
  seenAuth = "unused"
  const r = await resolveSession(null, fakeFetch(() => json(200, {})))
  assert.equal(r.status, "unauthenticated")
  assert.equal(seenAuth, "unused", "must not call the API without a token")
})

await check("200 + valid user -> authenticated", async () => {
  const r = await resolveSession("tok", fakeFetch(() => json(200, { user: USER })))
  assert.equal(r.status, "authenticated")
  assert.deepEqual(r.status === "authenticated" && r.user, USER)
})

await check("token is sent as Authorization: Bearer", async () => {
  await resolveSession("tok123", fakeFetch(() => json(200, { user: USER })))
  assert.equal(seenAuth, "Bearer tok123")
})

await check("200 + malformed body -> retryable error", async () => {
  const r = await resolveSession("tok", fakeFetch(() => json(200, { user: { id: 5 } })))
  assert.equal(r.status, "error")
  assert.equal(r.status === "error" && r.retryable, true)
})

await check("200 + non-JSON body -> retryable error", async () => {
  const r = await resolveSession("tok", fakeFetch(() => new Response("<html>nope", { status: 200 })))
  assert.equal(r.status, "error")
})

await check("401 -> expired (stale/tampered token)", async () => {
  const r = await resolveSession("tok", fakeFetch(() => json(401, { error: "invalid_token" })))
  assert.equal(r.status, "expired")
})

await check("404 -> expired (account deleted)", async () => {
  const r = await resolveSession("tok", fakeFetch(() => json(404, { error: "invalid_token" })))
  assert.equal(r.status, "expired")
})

await check("503 server_not_configured -> retryable error with setup copy", async () => {
  const r = await resolveSession("tok", fakeFetch(() => json(503, { error: "server_not_configured" })))
  assert.equal(r.status, "error")
  assert.equal(r.status === "error" && r.retryable, true)
  assert.match(r.status === "error" ? r.message : "", /configured/)
})

await check("500 -> retryable error", async () => {
  const r = await resolveSession("tok", fakeFetch(() => json(500, { error: "server_not_configured" })))
  assert.equal(r.status === "error" && r.retryable, true)
})

await check("400 -> non-retryable error", async () => {
  const r = await resolveSession("tok", fakeFetch(() => json(400, { error: "invalid_body" })))
  assert.equal(r.status, "error")
  assert.equal(r.status === "error" && r.retryable, false)
})

await check("network failure -> retryable error, never throws", async () => {
  const r = await resolveSession("tok", fakeFetch(() => { throw new Error("ECONNREFUSED") }))
  assert.equal(r.status, "error")
  assert.equal(r.status === "error" && r.retryable, true)
})

console.log("\n" + pass + "/" + pass + " session-core assertions passed")
