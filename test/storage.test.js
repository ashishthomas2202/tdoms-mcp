import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dataDir } from "../src/config.js";
import { ConnectionStore } from "../src/connection-store.js";
import { parseMasterKey, SecretStore } from "../src/secret-store.js";
import { hardenDataDirectory } from "../src/storage-utils.js";

test("selects deterministic data directories for Windows macOS Linux and WSL", () => {
  assert.equal(dataDir({ platform: "win32", env: { APPDATA: "C:\\Users\\Demo\\AppData\\Roaming" }, homedir: "C:\\Users\\Demo" }), "C:\\Users\\Demo\\AppData\\Roaming\\tdoms-mcp");
  assert.equal(dataDir({ platform: "darwin", env: {}, homedir: "/Users/demo" }), "/Users/demo/Library/Application Support/tdoms-mcp");
  assert.equal(dataDir({ platform: "linux", env: {}, homedir: "/home/demo" }), "/home/demo/.config/tdoms-mcp");
  assert.equal(dataDir({ platform: "linux", env: { XDG_CONFIG_HOME: "/config" }, homedir: "/home/demo" }), "/config/tdoms-mcp");
});

test("encrypts secrets without plaintext and preserves the existing local-key format", async () => {
  await withTempDirectory(async (dir) => {
    const store = new SecretStore(dir, { env: {} });
    await store.setSecret("password", "not-plaintext-password");
    assert.equal(await store.getSecret("password"), "not-plaintext-password");

    const secrets = await fs.readFile(path.join(dir, "secrets.json"), "utf8");
    assert.equal(secrets.includes("not-plaintext-password"), false);
    assert.equal(Buffer.from((await fs.readFile(path.join(dir, "local.key"), "utf8")).trim(), "base64").length, 32);
    assert.deepEqual((await fs.readdir(dir)).sort(), ["local.key", "secrets.json"]);
  });
});

test("supports an external master key without writing local.key", async () => {
  await withTempDirectory(async (dir) => {
    const key = crypto.randomBytes(32).toString("base64");
    const first = new SecretStore(dir, { env: { TDOMS_MCP_MASTER_KEY: key } });
    await first.setSecret("token", "external-key-token");
    const second = new SecretStore(dir, { env: { TDOMS_MCP_MASTER_KEY: key } });
    assert.equal(await second.getSecret("token"), "external-key-token");
    assert.equal((await fs.readdir(dir)).includes("local.key"), false);
  });
});

test("rejects malformed external master keys", () => {
  assert.throws(() => parseMasterKey("too-short"), /exactly 32 bytes/);
  assert.equal(parseMasterKey("a".repeat(64)).length, 32);
});

test("serializes concurrent updates from separate store instances", async () => {
  await withTempDirectory(async (dir) => {
    const stores = [new ConnectionStore(dir), new ConnectionStore(dir), new ConnectionStore(dir)];
    await Promise.all(Array.from({ length: 18 }, async (_, index) => {
      const store = stores[index % stores.length];
      await store.upsertConnection({
        id: `connection-${index}`,
        name: `Connection ${index}`,
        host: `host-${index}.example.test`,
        username: `user-${index}`,
        password: `password-${index}`
      });
    }));

    const connections = await stores[0].listConnections();
    assert.equal(connections.length, 18);
    for (let index = 0; index < 18; index += 1) {
      const connection = await stores[1].getConnection(`connection-${index}`, { includeSecrets: true });
      assert.equal(connection.password, `password-${index}`);
    }
    assert.equal((await fs.readdir(dir)).some((name) => name.endsWith(".lock") || name.endsWith(".tmp")), false);
  });
});

test("hardens the data directory for the current operating system", async () => {
  await withTempDirectory(async (dir) => {
    const result = await hardenDataDirectory(dir);
    assert.equal(result.platform, process.platform);
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
    } else {
      assert.match(result.acl, /current-user/);
    }
  });
});

async function withTempDirectory(operation) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tdoms-mcp-test-"));
  try {
    return await operation(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}
