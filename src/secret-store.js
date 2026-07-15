import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, ensurePrivateDirectory, withFileLock } from "./storage-utils.js";

const KEY_FILE = "local.key";
const SECRET_FILE = "secrets.json";
const ALGORITHM = "aes-256-gcm";

export class SecretStore {
  constructor(dir, { env = process.env } = {}) {
    this.dir = dir;
    this.env = env;
    this.keyPath = path.join(dir, KEY_FILE);
    this.secretPath = path.join(dir, SECRET_FILE);
  }

  async getSecret(name) {
    const secrets = await this.#readSecrets();
    const encrypted = secrets[name];
    if (!encrypted) {
      return undefined;
    }

    const key = await this.#getKey();
    const iv = Buffer.from(encrypted.iv, "base64");
    const tag = Buffer.from(encrypted.tag, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  }

  async setSecret(name, value) {
    await withFileLock(this.secretPath, async () => {
      const secrets = await this.#readSecrets();
      const key = await this.#getKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
      secrets[name] = {
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        updatedAt: new Date().toISOString()
      };
      await this.#writeSecrets(secrets);
    });
  }

  async deleteSecret(name) {
    await withFileLock(this.secretPath, async () => {
      const secrets = await this.#readSecrets();
      delete secrets[name];
      await this.#writeSecrets(secrets);
    });
  }

  async #getKey() {
    const configuredKey = parseMasterKey(this.env.TDOMS_MCP_MASTER_KEY);
    if (configuredKey) return configuredKey;

    await ensurePrivateDirectory(this.dir);
    return withFileLock(this.keyPath, async () => {
      try {
        const stored = Buffer.from((await fs.readFile(this.keyPath, "utf8")).trim(), "base64");
        return validateKey(stored, "local.key");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      const key = crypto.randomBytes(32);
      await atomicWriteFile(this.keyPath, key.toString("base64"), { mode: 0o600 });
      return key;
    });
  }

  async #readSecrets() {
    try {
      return JSON.parse(await fs.readFile(this.secretPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  async #writeSecrets(secrets) {
    await atomicWriteFile(this.secretPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  }
}

export function parseMasterKey(value) {
  if (!value) return undefined;
  const normalized = String(value).trim();
  const encoding = /^[a-f0-9]{64}$/i.test(normalized) ? "hex" : "base64";
  return validateKey(Buffer.from(normalized, encoding), "TDOMS_MCP_MASTER_KEY");
}

function validateKey(key, source) {
  if (key.length !== 32) {
    throw new Error(`${source} must contain exactly 32 bytes encoded as base64 or 64 hexadecimal characters.`);
  }
  return key;
}
