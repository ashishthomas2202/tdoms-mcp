// Optional sign-in to an Octo server. TD/OMS itself only needs the IBM i REST
// sign-in; an Octo account adds what the Octo server publishes on top of it, such
// as its MCP tool definitions and agent skills. Only the API key is kept, encrypted
// in the local secret store. The password is used once and never stored.

import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, withFileLock } from "./storage-utils.js";

const API_VERSION_PATH = "api/v1";
const ACCOUNT_FILE = "octo.json";
const API_KEY_SECRET = "octo:apiKey";
const DEFAULT_TIMEOUT_MS = 20000;

// Accepts "https://octo.example.com/org/acme", "https://octo.example.com" or a
// full API address, and returns the pieces the REST calls need.
export function parseOctoUrl(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("The Octo organization URL is required, for example https://octo.example.com/org/acme");
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Error(`Not a valid Octo URL: ${text}`);
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const orgIndex = segments.findIndex((segment) => segment.toLowerCase() === "org");
  const organization = orgIndex >= 0 ? decodeURIComponent(segments[orgIndex + 1] || "") : "";
  const apiIndex = segments.findIndex((segment, index) => segment === "api" && segments[index + 1] === "v1");
  const prefix = segments.slice(0, apiIndex >= 0 ? apiIndex : orgIndex >= 0 ? orgIndex : segments.length).join("/");
  const serverUrl = `${url.origin}${prefix ? `/${prefix}` : ""}`;
  return {
    serverUrl,
    apiBase: `${serverUrl}/${API_VERSION_PATH}`,
    organization: organization || undefined
  };
}

export class OctoRequestError extends Error {
  constructor(message, { status, path: requestPath, body } = {}) {
    super(message);
    this.name = "OctoRequestError";
    this.status = status;
    this.path = requestPath;
    this.body = body;
  }
}

export class OctoClient {
  constructor({ apiBase, apiKey, organizationId, accessToken, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!apiBase) throw new Error("An Octo API address is required.");
    this.apiBase = String(apiBase).replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.organizationId = organizationId;
    this.accessToken = accessToken;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(method, requestPath, body) {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.apiKey) headers["api-key"] = this.apiKey;
    if (this.organizationId) headers["organization-id"] = this.organizationId;
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;

    let response;
    try {
      response = await this.fetchImpl(`${this.apiBase}/${String(requestPath).replace(/^\/+/, "")}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new OctoRequestError(`Could not reach the Octo server: ${error.cause?.message || error.message}`, { path: requestPath });
    }

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!response.ok) {
      const detail = parsed?.err_msg || parsed?.message || parsed?.error || response.statusText || "request failed";
      throw new OctoRequestError(`Octo server answered ${response.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`, {
        status: response.status,
        path: requestPath,
        body: parsed
      });
    }
    return parsed;
  }

  signIn(emailOrUsername, password) {
    return this.request("POST", "user/sign/in", { email_or_username: emailOrUsername, password });
  }

  verifyTwoFactorCode(userId, code) {
    return this.request("POST", "security/2fa/code/verify", { id: userId, auth_2fa_code: code });
  }

  listServerDefinitions() {
    return this.request("GET", "ai/mcp/openapi/definitions/server");
  }

  listToolDefinitions() {
    return this.request("GET", "ai/mcp/openapi/definitions/tools");
  }

  listSkills() {
    return this.request("GET", "ai/skill/all");
  }
}

// Reduces the user record the server returns to the few fields kept locally.
export function summarizeOctoUser(user, { organization } = {}) {
  const record = unwrap(user) || {};
  const apiKeyValue = record.api_key ?? record.apiKey;
  const apiKey = typeof apiKeyValue === "string" ? apiKeyValue : apiKeyValue?.key;
  const organizations = (Array.isArray(record.tenants) ? record.tenants : Object.values(record.tenants || {}))
    .map((entry) => entry?.tenant || entry)
    .filter((tenant) => tenant && (tenant.id || tenant._id))
    .map((tenant) => ({
      id: String(tenant.id || tenant._id),
      name: tenant.name || tenant.title || tenant.url_name,
      urlName: tenant.url_name || tenant.urlName
    }));
  const wanted = String(organization || "").toLowerCase();
  const selected = organizations.find((entry) => wanted && [entry.urlName, entry.name].some((name) => String(name || "").toLowerCase() === wanted))
    || (organizations.length === 1 ? organizations[0] : undefined);
  return {
    userId: record.id || record._id ? String(record.id || record._id) : undefined,
    username: record.username,
    email: record.email,
    apiKey: apiKey || undefined,
    accessToken: record.access_token || undefined,
    twoFactorEnabled: record.is_2fa_enabled === true,
    twoFactorVerified: record.is_2fa_verified === true,
    organizations,
    organizationId: selected?.id,
    organizationName: selected?.name
  };
}

// Signs in and saves the account. Returns { ok: false, needsCode: true } when the
// account uses two-factor sign-in and no code was supplied yet.
export async function signInToOcto({ url, username, password, code, accounts, fetchImpl, clock = () => new Date() }) {
  const target = parseOctoUrl(url);
  if (!username || !password) throw new Error("An Octo username or email and a password are required.");

  const client = new OctoClient({ apiBase: target.apiBase, fetchImpl });
  let user = summarizeOctoUser(await client.signIn(String(username).trim(), password), target);

  if (user.twoFactorEnabled && !user.twoFactorVerified) {
    if (!code) return { ok: false, needsCode: true, message: "This Octo account uses two-factor sign-in. Enter the code from your authenticator app." };
    if (!user.userId) throw new Error("The Octo server did not return a user id, so the two-factor code cannot be checked.");
    const verified = summarizeOctoUser(await client.verifyTwoFactorCode(user.userId, String(code).trim()), target);
    user = { ...user, ...dropEmpty(verified), organizations: verified.organizations.length ? verified.organizations : user.organizations };
  }

  if (!user.apiKey) throw new Error("Sign-in worked but the Octo server did not return an API key for this account.");

  const account = {
    serverUrl: target.serverUrl,
    apiBase: target.apiBase,
    organization: target.organization,
    organizationId: user.organizationId,
    organizationName: user.organizationName,
    organizations: user.organizations,
    userId: user.userId,
    username: user.username || String(username).trim(),
    email: user.email,
    signedInAt: clock().toISOString()
  };
  await accounts.save(account, user.apiKey);
  return { ok: true, account: await accounts.get() };
}

// Read-only check of what the signed-in Octo account can see. Returns counts and
// names only, so the result is safe to paste into a chat or an issue.
export async function probeOcto({ accounts, fetchImpl }) {
  const account = await accounts.get({ includeSecrets: true });
  if (!account?.signedIn) return { ok: false, reason: "Not signed in to Octo. Run `tdoms-mcp octo-login` or use the setup page first." };

  const client = new OctoClient({ apiBase: account.apiBase, apiKey: account.apiKey, organizationId: account.organizationId, fetchImpl });
  const checks = [];
  for (const [id, label, run] of [
    ["serverDefinitions", "MCP server definitions", () => client.listServerDefinitions()],
    ["toolDefinitions", "MCP tool definitions", () => client.listToolDefinitions()],
    ["skills", "Agent skills", () => client.listSkills()]
  ]) {
    try {
      const items = asList(await run());
      checks.push({ id, label, ok: true, count: items.length, names: items.map(itemName).filter(Boolean).slice(0, 50), fields: fieldNames(items[0]) });
    } catch (error) {
      checks.push({ id, label, ok: false, status: error.status, error: error.message });
    }
  }
  return {
    ok: checks.every((check) => check.ok),
    serverUrl: account.serverUrl,
    organization: account.organization,
    organizationIdKnown: Boolean(account.organizationId),
    checks
  };
}

// Keeps the Octo account next to the saved connections. Works with any store that
// exposes `dir` and `secrets` the way ConnectionStore does.
export class OctoAccountStore {
  constructor(store) {
    this.store = store;
    this.filePath = path.join(store.dir, ACCOUNT_FILE);
  }

  async get({ includeSecrets = false } = {}) {
    let account;
    try {
      account = JSON.parse(await fs.readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return { signedIn: false };
      throw error;
    }
    const apiKey = await this.store.secrets.getSecret(API_KEY_SECRET);
    return {
      ...account,
      signedIn: Boolean(apiKey && account?.apiBase),
      ...(includeSecrets ? { apiKey } : {})
    };
  }

  async save(account, apiKey) {
    await withFileLock(this.filePath, async () => {
      await atomicWriteFile(this.filePath, `${JSON.stringify(account, null, 2)}\n`, { mode: 0o600 });
    });
    await this.store.secrets.setSecret(API_KEY_SECRET, apiKey);
  }

  async clear() {
    await this.store.secrets.deleteSecret(API_KEY_SECRET);
    await fs.rm(this.filePath, { force: true });
  }
}

function unwrap(body) {
  if (body && typeof body === "object" && !Array.isArray(body) && body.data && typeof body.data === "object" && !("id" in body) && !("username" in body)) {
    return body.data;
  }
  return body;
}

function asList(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  return body && typeof body === "object" ? [body] : [];
}

function itemName(item) {
  return [item?.name, item?.title, item?.operation_id, item?.operationId, item?.short_id, item?.id].find((value) => typeof value === "string" && value);
}

function fieldNames(item) {
  return item && typeof item === "object" ? Object.keys(item).slice(0, 40) : [];
}

function dropEmpty(source) {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== false && !(Array.isArray(value) && value.length === 0)));
}
