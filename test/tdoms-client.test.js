import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import { TdomsClient } from "../src/tdoms-client.js";

test("enforces TLS verification by default", async () => {
  const harness = requestHarness({ body: { ok: true } });
  const client = new TdomsClient(connection(), { httpsRequest: harness.request });
  assert.deepEqual(await client.getLicenseInfo(), { ok: true });
  assert.equal(harness.calls[0].options.rejectUnauthorized, true);
});

test("honors explicit TLS disablement through the actual HTTPS request options", async () => {
  const harness = requestHarness({ body: { ok: true } });
  const client = new TdomsClient(connection({ verifyTls: false }), { httpsRequest: harness.request });
  await client.getLicenseInfo();
  assert.equal(harness.calls[0].options.rejectUnauthorized, false);
});

test("loads a custom CA while retaining public roots", async () => {
  const harness = requestHarness({ body: { ok: true } });
  const reads = [];
  const client = new TdomsClient(connection({ caFile: "company-ca.pem" }), {
    httpsRequest: harness.request,
    readFile: async (file, encoding) => {
      reads.push({ file, encoding });
      return "TEST COMPANY CA";
    }
  });
  await client.getLicenseInfo();
  assert.equal(reads.length, 1);
  assert.equal(reads[0].encoding, "utf8");
  assert.ok(harness.calls[0].options.ca.length > 1);
  assert.equal(harness.calls[0].options.ca.at(-1), "TEST COMPANY CA");
});

test("sends login credentials only in the HTTPS request body", async () => {
  const harness = requestHarness({ body: { token: "new-token" } });
  const client = new TdomsClient(connection({ username: "demo-user", password: "demo-password" }), { httpsRequest: harness.request });
  assert.equal(await client.login(), "new-token");
  assert.equal(harness.calls[0].url.protocol, "https:");
  assert.deepEqual(JSON.parse(harness.calls[0].payload), {
    email_or_username: "demo-user",
    password: "demo-password"
  });
});

test("preserves TD/OMS status errors for automatic token refresh", async () => {
  const harness = requestHarness({ statusCode: 401, body: { error: "expired" } });
  const client = new TdomsClient(connection(), { httpsRequest: harness.request });
  await assert.rejects(client.get("OMSINFO", "/system", "expired-token"), /failed with 401/);
});

function connection(overrides = {}) {
  return {
    protocol: "https",
    host: "tdoms.example.test",
    port: "45011",
    library: "OMS",
    verifyTls: true,
    ...overrides
  };
}

function requestHarness({ statusCode = 200, body }) {
  const calls = [];
  return {
    calls,
    request(url, options, callback) {
      const request = new EventEmitter();
      const chunks = [];
      request.setTimeout = () => request;
      request.write = (chunk) => chunks.push(String(chunk));
      request.destroy = (error) => request.emit("error", error);
      request.end = () => {
        const response = Readable.from([JSON.stringify(body)]);
        response.statusCode = statusCode;
        calls.push({ url, options, payload: chunks.join("") });
        callback(response);
      };
      return request;
    }
  };
}
