import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataDir, normalizeBaseUrl, redactConnection } from "./config.js";
import { SecretStore } from "./secret-store.js";
import { atomicWriteFile, withFileLock } from "./storage-utils.js";

const CONNECTIONS_FILE = "connections.json";
const CONTEXT_FILE = "context.json";

export class ConnectionStore {
  constructor(dir = dataDir(), { env = process.env } = {}) {
    this.dir = dir;
    this.filePath = path.join(dir, CONNECTIONS_FILE);
    this.contextPath = path.join(dir, CONTEXT_FILE);
    this.secrets = new SecretStore(dir, { env });
  }

  async getWorkingContext() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.contextPath, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return {};
      throw error;
    }
  }

  async setWorkingContext(context) {
    await withFileLock(this.contextPath, async () => {
      await atomicWriteFile(this.contextPath, `${JSON.stringify(context || {}, null, 2)}\n`, { mode: 0o600 });
    });
  }

  async listConnections() {
    const state = await this.#readState();
    return state.connections.map(redactConnection);
  }

  async getConnection(id, { includeSecrets = false } = {}) {
    const state = await this.#readState();
    const connection = state.connections.find((item) => item.id === id);
    if (!connection) {
      return undefined;
    }

    if (!includeSecrets) {
      return redactConnection(connection);
    }

    return {
      ...connection,
      password: await this.secrets.getSecret(`connection:${id}:password`),
      token: await this.secrets.getSecret(`connection:${id}:token`)
    };
  }

  async upsertConnection(input) {
    const id = input.id || crypto.randomUUID();
    let connection;
    await withFileLock(this.filePath, async () => {
      const state = await this.#readState();
      const now = new Date().toISOString();
      const existing = state.connections.find((item) => item.id === id);
      connection = {
        id,
        name: String(input.name || input.host || "TD/OMS").trim(),
        protocol: input.protocol || "https",
        host: String(input.host || "").trim(),
        port: String(input.port || "").trim(),
        library: String(input.library || "OMS").trim(),
        username: String(input.username || "").trim(),
        verifyTls: input.verifyTls !== false,
        caFile: String(input.caFile || "").trim() || undefined,
        email: String(input.email ?? existing?.email ?? "").trim() || undefined,
        source: String(input.source ?? existing?.source ?? "").trim() || undefined,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        lastLoginAt: existing?.lastLoginAt,
        lastSystemProbeAt: existing?.lastSystemProbeAt,
        lastStatus: existing?.lastStatus || "never-tested"
      };
      connection.baseUrl = normalizeBaseUrl(connection);

      const index = state.connections.findIndex((item) => item.id === id);
      if (index >= 0) state.connections[index] = connection;
      else state.connections.push(connection);
      await this.#writeState(state);
    });

    if (input.password) {
      await this.secrets.setSecret(`connection:${id}:password`, input.password);
    }

    return redactConnection(connection);
  }

  async updateStatus(id, patch) {
    return withFileLock(this.filePath, async () => {
      const state = await this.#readState();
      const index = state.connections.findIndex((item) => item.id === id);
      if (index < 0) throw new Error(`Connection not found: ${id}`);
      state.connections[index] = {
        ...state.connections[index],
        ...patch,
        updatedAt: new Date().toISOString()
      };
      await this.#writeState(state);
      return redactConnection(state.connections[index]);
    });
  }

  async saveToken(id, token) {
    await this.secrets.setSecret(`connection:${id}:token`, token);
    await this.updateStatus(id, {
      lastStatus: "logged-in",
      lastLoginAt: new Date().toISOString()
    });
  }

  async deleteConnection(id) {
    await withFileLock(this.filePath, async () => {
      const state = await this.#readState();
      state.connections = state.connections.filter((item) => item.id !== id);
      await this.#writeState(state);
    });
    await this.secrets.deleteSecret(`connection:${id}:password`);
    await this.secrets.deleteSecret(`connection:${id}:token`);
  }

  async #readState() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      return { connections: Array.isArray(parsed.connections) ? parsed.connections : [] };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { connections: [] };
      }
      throw error;
    }
  }

  async #writeState(state) {
    await atomicWriteFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  }
}
