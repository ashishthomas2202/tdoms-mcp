// Reads the TD/OMS session that the Octo extension shares with its own MCP
// servers, so a user who is signed in to Octo does not have to configure the same
// server twice. The file is encrypted with a key derived from the local user and
// machine names, so it can only be read on the machine that wrote it.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SALT = "octo-mcp-data-salt-v1";

export function octoSessionFilePath(homedir = os.homedir()) {
  return path.join(homedir, ".remain", "octo", "ai", "mcp", "data", "tdoms", "tdoms_mcp_config.json");
}

export function deriveOctoKey({ username, hostname }) {
  return crypto.scryptSync(`octo-mcp|${username}|${hostname}`, SALT, 32);
}

export function decryptOctoData(encoded, key) {
  const parts = String(encoded || "").trim().split(":");
  if (parts.length !== 3) {
    throw new Error("Octo session file is not in the expected format.");
  }
  const [iv, tag, cipherText] = parts.map((part) => Buffer.from(part, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString("utf8");
}

export function encryptOctoData(plainText, key, iv = crypto.randomBytes(12)) {
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const cipherText = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), cipherText].map((part) => part.toString("base64")).join(":");
}

export async function readOctoSession({
  homedir = os.homedir(),
  username = localUsername(),
  hostname = os.hostname(),
  readFile = fs.readFile,
  now = Date.now()
} = {}) {
  const filePath = octoSessionFilePath(homedir);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { found: false, reason: "No Octo session file exists on this machine." };
    throw error;
  }
  if (!String(content).trim()) return { found: false, reason: "The Octo session file is empty. Sign in to Octo first." };

  let config;
  try {
    config = JSON.parse(decryptOctoData(content, deriveOctoKey({ username, hostname })));
  } catch {
    return { found: false, reason: "The Octo session file could not be read. It can only be read by the same user on the machine that created it." };
  }

  const target = parseBasePath(config?.basePath);
  if (!target) return { found: false, reason: "The Octo session has no TD/OMS server address. Sign in to Octo first." };

  const claims = decodeJwtClaims(config.accessToken);
  const expiresAt = Number.isFinite(claims?.exp) ? claims.exp * 1000 : undefined;
  return {
    found: true,
    ...target,
    basePath: `${target.protocol}://${target.host}:${target.port}/${target.library}`,
    accessToken: config.accessToken || undefined,
    username: firstString(claims, ["username", "user", "preferred_username", "sub", "upn", "name"]),
    email: firstString(claims, ["email", "mail"]),
    tokenExpiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    tokenExpired: expiresAt ? expiresAt <= now : undefined
  };
}

export async function importOctoConnection(store, { session, reuseToken = true, username, name } = {}) {
  const octo = session || await readOctoSession();
  if (!octo.found) return { ok: false, imported: false, reason: octo.reason };

  const resolvedUsername = String(username || octo.username || "").trim();
  const existing = (await store.listConnections()).find((connection) =>
    String(connection.host).toLowerCase() === octo.host.toLowerCase()
    && String(connection.port) === octo.port
    && String(connection.library).toLowerCase() === octo.library.toLowerCase()
    && (!resolvedUsername || !connection.username || connection.username.toLowerCase() === resolvedUsername.toLowerCase())
  );

  const connection = await store.upsertConnection({
    ...(existing || {}),
    id: existing?.id,
    name: name || existing?.name || `Octo ${octo.host}`,
    protocol: octo.protocol,
    host: octo.host,
    port: octo.port,
    library: octo.library,
    username: resolvedUsername || existing?.username || "",
    email: octo.email || existing?.email,
    source: existing?.source || "octo"
  });

  const tokenUsable = Boolean(octo.accessToken) && octo.tokenExpired !== true;
  if (reuseToken && tokenUsable) {
    await store.saveToken(connection.id, octo.accessToken);
  }

  return {
    ok: true,
    imported: true,
    created: !existing,
    connection: await store.getConnection(connection.id),
    tokenReused: Boolean(reuseToken && tokenUsable),
    tokenExpiresAt: octo.tokenExpiresAt,
    warnings: [
      !resolvedUsername && "The Octo session did not reveal a TD/OMS username. Set one so task lists can default to the current programmer.",
      reuseToken && !tokenUsable && "The Octo token is missing or expired. Sign in to Octo again or save a password with `tdoms-mcp login`."
    ].filter(Boolean)
  };
}

export function parseBasePath(basePath) {
  let url;
  try {
    url = new URL(String(basePath || ""));
  } catch {
    return undefined;
  }
  const protocol = url.protocol.replace(":", "");
  if (!["http", "https"].includes(protocol) || !url.hostname) return undefined;
  const segments = url.pathname.split("/").filter(Boolean);
  return {
    protocol,
    host: url.hostname,
    port: url.port || (protocol === "https" ? "443" : "80"),
    library: segments.at(-1) || "OMS"
  };
}

export function decodeJwtClaims(token) {
  const payload = String(token || "").replace(/^Bearer\s+/i, "").split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims && typeof claims === "object" ? claims : undefined;
  } catch {
    return undefined;
  }
}

function firstString(source, keys) {
  for (const key of keys) {
    if (typeof source?.[key] === "string" && source[key].trim()) return source[key].trim();
  }
  return undefined;
}

function localUsername() {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USERNAME || process.env.USER || "";
  }
}
