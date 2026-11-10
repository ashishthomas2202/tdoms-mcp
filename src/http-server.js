// Streamable HTTP transport, for apps and agents that cannot launch a local stdio
// process. Every request needs the bearer token; the listener binds to localhost
// unless told otherwise.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_HOST, dataDir } from "./config.js";
import { ConnectionStore } from "./connection-store.js";
import { createMcpServer } from "./mcp-server.js";
import { atomicWriteFile, ensurePrivateDirectory } from "./storage-utils.js";

export const DEFAULT_HTTP_PORT = 3738;
const TOKEN_FILE = "http-token";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export async function resolveHttpToken({ env = process.env, dir = dataDir() } = {}) {
  if (env.TDOMS_MCP_HTTP_TOKEN) return { token: env.TDOMS_MCP_HTTP_TOKEN, source: "TDOMS_MCP_HTTP_TOKEN" };
  const filePath = path.join(dir, TOKEN_FILE);
  try {
    const saved = (await fs.readFile(filePath, "utf8")).trim();
    if (saved) return { token: saved, source: filePath };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const token = crypto.randomBytes(32).toString("base64url");
  await ensurePrivateDirectory(dir);
  await atomicWriteFile(filePath, `${token}\n`, { mode: 0o600 });
  return { token, source: filePath };
}

export function createHttpApp({ store = new ConnectionStore(), token, profile, groups, host = DEFAULT_HOST, serverFactory = createMcpServer } = {}) {
  if (!token) throw new Error("An access token is required for the HTTP transport.");
  const expected = Buffer.from(`Bearer ${token}`);
  const sessions = new Map();
  const workflowPlans = new Map();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "8mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true, name: "tdoms-mcp", transport: "streamable-http" }));

  app.use("/mcp", (req, res, next) => {
    // Browsers on other sites must not reach a localhost listener.
    const hostname = String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
    if (LOOPBACK.has(host) && !LOOPBACK.has(hostname)) {
      return res.status(403).json(rpcError(-32000, "Forbidden host."));
    }
    const provided = Buffer.from(String(req.headers.authorization || ""));
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      res.set("WWW-Authenticate", "Bearer");
      return res.status(401).json(rpcError(-32001, "Missing or invalid bearer token."));
    }
    return next();
  });

  app.post("/mcp", async (req, res, next) => {
    try {
      const sessionId = req.headers["mcp-session-id"];
      let transport = sessionId ? sessions.get(sessionId) : undefined;
      if (!transport) {
        if (sessionId || !isInitializeRequest(req.body)) {
          return res.status(sessionId ? 404 : 400).json(rpcError(-32000, sessionId ? "Unknown session. Initialize again." : "Send an initialize request first."));
        }
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => sessions.set(id, transport)
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        // Plans are shared so a plan survives a client reconnecting with a new session.
        await serverFactory({ store, profile, groups, workflowPlans }).connect(transport);
      }
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      next(error);
    }
  });

  const existingSession = async (req, res, next) => {
    try {
      const transport = sessions.get(req.headers["mcp-session-id"]);
      if (!transport) return res.status(404).json(rpcError(-32000, "Unknown session."));
      await transport.handleRequest(req, res);
    } catch (error) {
      next(error);
    }
  };
  app.get("/mcp", existingSession);
  app.delete("/mcp", existingSession);

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    res.status(error?.type === "entity.parse.failed" ? 400 : 500).json(rpcError(-32603, error?.type === "entity.parse.failed" ? "Invalid JSON." : "Internal error."));
  });

  app.locals.sessions = sessions;
  return app;
}

export async function startHttpServer({ store, profile, groups, host = DEFAULT_HOST, port = DEFAULT_HTTP_PORT, env = process.env } = {}) {
  if (!LOOPBACK.has(host) && env.TDOMS_MCP_HTTP_ALLOW_REMOTE !== "1") {
    throw new Error(`Refusing to listen on ${host}. Requests carry TD/OMS access over plain HTTP, so keep it on 127.0.0.1 or put it behind a TLS proxy and set TDOMS_MCP_HTTP_ALLOW_REMOTE=1.`);
  }
  const { token, source } = await resolveHttpToken({ env });
  const app = createHttpApp({ store, token, profile, groups, host });
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, host, () => resolve(listener));
    listener.on("error", reject);
  });
  return { server, host, port: server.address().port, tokenSource: source, url: `http://${host}:${server.address().port}/mcp` };
}

function rpcError(code, message) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}
