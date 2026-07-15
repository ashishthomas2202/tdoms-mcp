import assert from "node:assert/strict";
import test from "node:test";
import { createWebApp } from "../src/web-app.js";

test("serves the professional console and client-management API", async () => {
  const installs = [];
  const store = {
    async listConnections() { return []; }
  };
  const clientManager = {
    async listClients() { return [{ id: "codex", name: "Codex", detected: true, configured: false }]; },
    async installClient(id, options) { installs.push({ id, options }); return { ok: true, clientId: id }; },
    async installDetected(options) { installs.push({ id: "detected", options }); return { ok: true, configured: 1, failed: 0 }; }
  };
  const server = createWebApp({ store, clientManager }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const page = await (await fetch(base)).text();
    assert.match(page, /TD\/OMS MCP/);
    assert.match(page, /Agent setup/);
    assert.match(page, /MCP clients/);
    assert.match(page, /Advanced settings/);

    const clients = await (await fetch(`${base}/api/clients`)).json();
    assert.equal(clients.clients[0].id, "codex");

    const installed = await (await fetch(`${base}/api/clients/codex/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: true })
    })).json();
    assert.equal(installed.ok, true);
    const bulk = await (await fetch(`${base}/api/clients/install-detected`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: true })
    })).json();
    assert.equal(bulk.configured, 1);
    assert.deepEqual(installs, [
      { id: "codex", options: { confirm: true } },
      { id: "detected", options: { confirm: true } }
    ]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
