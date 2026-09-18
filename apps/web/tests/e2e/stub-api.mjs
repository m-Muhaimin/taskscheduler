// Stub of the DB-backed API so the web session wiring can be exercised in a
// real browser. Keyed off the token value so every branch is drivable by cookie.
import { createServer } from "node:http"

const PORT = 3002
const SAM = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "sam@solosam.test",
  displayName: "Sam Rivera",
}

const json = (res, status, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) })
  res.end(payload)
}

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost")
  const auth = req.headers.authorization ?? ""
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null

  if (url.pathname === "/api/health") return json(res, 200, { status: "ok" })

  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    if (token === "stub.valid") return json(res, 200, { user: SAM })
    if (token === "stub.serverdown") return json(res, 503, { error: "server_not_configured" })
    return json(res, 401, { error: "invalid_token" })
  }

  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      let body = {}
      try { body = JSON.parse(raw) } catch {}
      if (body.password === "server-down") return json(res, 503, { error: "server_not_configured" })
      if (body.password === "correct-horse" && typeof body.email === "string" && body.email.includes("@")) {
        return json(res, 200, { token: "stub.valid", user: SAM })
      }
      return json(res, 401, { error: "invalid_credentials" })
    })
    return
  }

  if (url.pathname === "/api/auth/register" && req.method === "POST") {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => json(res, 201, { token: "stub.valid", user: SAM }))
    return
  }

  json(res, 404, { error: "not_found" })
}).listen(PORT, () => console.log(`[stub] on http://localhost:${PORT}`))
