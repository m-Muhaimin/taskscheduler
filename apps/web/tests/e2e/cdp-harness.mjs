// Minimal Chrome DevTools Protocol driver — no dependencies (node 22+ WebSocket).
import { spawn } from "node:child_process"
import { rmSync } from "node:fs"

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
const PORT = 9222
const PROFILE = "C:/Users/muhai/AppData/Local/Temp/cdp-profile"

export async function launch() {
  rmSync(PROFILE, { recursive: true, force: true })
  const proc = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore", detached: false })

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 300))
  }

  const created = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })
  const target = await created.json()

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let nextId = 1
  const pending = new Map()
  const events = []
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data)
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id)
      pending.delete(data.id)
      data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result)
    } else if (data.method) {
      events.push(data.method)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send("Page.enable")
  await send("Runtime.enable")
  // Desktop viewport: the sidebar is `hidden lg:block`, so a mobile-sized
  // viewport would exclude its text from innerText.
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  })

  return {
    proc,
    send,
    events,
    async goto(url) {
      events.length = 0
      await send("Page.navigate", { url })
      for (let i = 0; i < 100; i++) {
        if (events.includes("Page.loadEventFired")) break
        await new Promise((r) => setTimeout(r, 100))
      }
      await new Promise((r) => setTimeout(r, 250))
    },
    async evaluate(expression) {
      const r = await send("Runtime.evaluate", {
        expression, returnByValue: true, awaitPromise: true,
      })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""))
      return r.result.value
    },
    async waitFor(expression, timeoutMs = 12000) {
      const started = Date.now()
      while (Date.now() - started < timeoutMs) {
        try {
          if (await this.evaluate(expression)) return true
        } catch {}
        await new Promise((r) => setTimeout(r, 200))
      }
      return false
    },
    close() {
      ws.close()
      proc.kill()
    },
  }
}
