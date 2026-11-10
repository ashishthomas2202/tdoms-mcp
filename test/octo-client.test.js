import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConnectionStore } from "../src/connection-store.js";
import { OctoAccountStore, parseOctoUrl, probeOcto, signInToOcto, summarizeOctoUser } from "../src/octo-client.js";
import { createWebApp } from "../src/web-app.js";

function fakeOcto({ twoFactor = false } = {}) {
  const calls = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const user = {
    id: "u1",
    username: "dev",
    email: "dev@example.com",
    api_key: { key: "key-123" },
    is_2fa_enabled: twoFactor,
    is_2fa_verified: false,
    tenants: [{ tenant: { id: "org-1", name: "Acme", url_name: "acme" } }, { tenant: { id: "org-2", name: "Other", url_name: "other" } }]
  };
  const fetchImpl = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method: options.method, headers: options.headers, body });
    if (url.endsWith("/user/sign/in")) return body.password === "right" ? json(200, user) : json(401, { err_msg: "Invalid credentials" });
    if (url.endsWith("/security/2fa/code/verify")) return body.auth_2fa_code === "123456" ? json(200, { ...user, is_2fa_verified: true }) : json(400, { err_msg: "Wrong code" });
    if (options.headers["api-key"] !== "key-123") return json(401, { err_msg: "No key" });
    if (url.endsWith("/ai/mcp/openapi/definitions/server")) return json(200, [{ name: "tdoms", short_id: "abc" }]);
    if (url.endsWith("/ai/mcp/openapi/definitions/tools")) return json(200, [{ name: "getTasks" }, { name: "getRequests" }]);
    if (url.endsWith("/ai/skill/all")) return json(403, { err_msg: "Not allowed" });
    return json(404, {});
  };
  return { calls, fetchImpl };
}

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tdoms-octo-"));
  return new ConnectionStore(dir, { env: {} });
}

test("parses Octo organization URLs", () => {
  assert.deepEqual(parseOctoUrl("https://octo.example.com/org/acme"), { serverUrl: "https://octo.example.com", apiBase: "https://octo.example.com/api/v1", organization: "acme" });
  assert.deepEqual(parseOctoUrl("octo.example.com"), { serverUrl: "https://octo.example.com", apiBase: "https://octo.example.com/api/v1", organization: undefined });
  assert.equal(parseOctoUrl("http://host:8080/octo/api/v1/").apiBase, "http://host:8080/octo/api/v1");
  assert.throws(() => parseOctoUrl(""), /required/);
});

test("summarizes the signed-in user and picks the organization from the URL", () => {
  const summary = summarizeOctoUser({ data: { id: 7, api_key: "plain", tenants: [{ id: "a", url_name: "acme" }] } }, { organization: "ACME" });
  assert.equal(summary.userId, "7");
  assert.equal(summary.apiKey, "plain");
  assert.equal(summary.organizationId, "a");
});

test("signs in, stores only the API key encrypted, probes and signs out", async () => {
  const store = await tempStore();
  const accounts = new OctoAccountStore(store);
  const { calls, fetchImpl } = fakeOcto();

  await assert.rejects(signInToOcto({ url: "https://octo.example.com/org/acme", username: "dev", password: "wrong", accounts, fetchImpl }), /401.*Invalid credentials/);
  assert.equal((await accounts.get()).signedIn, false);

  const outcome = await signInToOcto({ url: "https://octo.example.com/org/acme", username: "dev", password: "right", accounts, fetchImpl });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.account.organizationId, "org-1");
  assert.equal(outcome.account.apiKey, undefined);

  const onDisk = await fs.readFile(path.join(store.dir, "octo.json"), "utf8");
  assert.doesNotMatch(onDisk, /key-123|right/);
  assert.doesNotMatch(await fs.readFile(path.join(store.dir, "secrets.json"), "utf8"), /key-123/);

  const probe = await probeOcto({ accounts, fetchImpl });
  assert.equal(probe.ok, false);
  assert.deepEqual(probe.checks.map((check) => [check.id, check.ok, check.count ?? check.status]), [["serverDefinitions", true, 1], ["toolDefinitions", true, 2], ["skills", false, 403]]);
  assert.doesNotMatch(JSON.stringify(probe), /key-123/);
  assert.equal(calls.at(-1).headers["organization-id"], "org-1");

  await accounts.clear();
  assert.equal((await accounts.get()).signedIn, false);
  assert.equal((await probeOcto({ accounts, fetchImpl })).ok, false);
});

test("asks for a two-factor code before saving anything", async () => {
  const store = await tempStore();
  const accounts = new OctoAccountStore(store);
  const { fetchImpl } = fakeOcto({ twoFactor: true });
  const first = await signInToOcto({ url: "https://octo.example.com/org/acme", username: "dev", password: "right", accounts, fetchImpl });
  assert.equal(first.needsCode, true);
  assert.equal((await accounts.get()).signedIn, false);
  const second = await signInToOcto({ url: "https://octo.example.com/org/acme", username: "dev", password: "right", code: "123456", accounts, fetchImpl });
  assert.equal(second.ok, true);
});

test("setup page API signs in to Octo, sets the active connection and rejects other hosts", async () => {
  const store = await tempStore();
  const { fetchImpl } = fakeOcto();
  const clientManager = { async listClients() { return []; } };
  const app = createWebApp({ store, clientManager, octoFetch: fetchImpl, octoSession: async () => ({ found: false, reason: "none" }) });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body) => (await fetch(base + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) })).json();

  try {
    const before = await (await fetch(`${base}/api/overview`)).json();
    assert.equal(before.octo.account.signedIn, false);
    assert.equal(before.groups.find((group) => group.id === "core").toolCount, 12);

    const signedIn = await post("/api/octo/sign-in", { url: "https://octo.example.com/org/acme", username: "dev", password: "right" });
    assert.equal(signedIn.ok, true);
    assert.equal(signedIn.octo.account.username, "dev");
    assert.doesNotMatch(JSON.stringify(signedIn), /key-123/);
    assert.equal((await post("/api/octo/probe")).checks.length, 3);
    assert.equal((await post("/api/octo/sign-out")).octo.account.signedIn, false);

    const connection = (await post("/api/connections", { name: "Dev", host: "tdoms.example.com", port: "1234", username: "DEVUSER" })).connection;
    assert.equal((await post("/api/context", { activeConnectionId: connection.id })).context.activeConnectionId, connection.id);

    const status = await new Promise((resolve, reject) => {
      import("node:http").then(({ default: http }) => {
        http.get({ host: "127.0.0.1", port: server.address().port, path: "/api/overview", headers: { host: "evil.example.com" } }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
      });
    });
    assert.equal(status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("stop command shuts down a running setup page and reports when none is running", async () => {
  const { startWebServer, stopWebServer } = await import("../src/web-app.js");
  const store = await tempStore();
  let stopped = false;
  const { server } = await startWebServer({ store, clientManager: { async listClients() { return []; } }, port: 0, onStopped: () => { stopped = true; } });
  const port = server.address().port;
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/overview`)).json()).canStop, true);

  const outcome = await stopWebServer({ port });
  assert.equal(outcome.stopped, true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(stopped, true);
  assert.equal(server.listening, false);

  const again = await stopWebServer({ port });
  assert.deepEqual([again.ok, again.running], [true, false]);
});
