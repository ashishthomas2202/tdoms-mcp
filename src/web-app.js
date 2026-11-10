import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ClientManager } from "./client-manager.js";
import { DEFAULT_HOST, DEFAULT_PORT, dataDir } from "./config.js";
import { ConnectionStore } from "./connection-store.js";
import { TdomsClient, summarizeSystemInfo } from "./tdoms-client.js";
import { renderPage } from "./ui-page.js";
import { OctoAccountStore, probeOcto, signInToOcto } from "./octo-client.js";
import { importOctoConnection, readOctoSession } from "./octo-session.js";
import { toolGroupSummary } from "./mcp-server.js";
import { readWorkingContext, updateWorkingContext } from "./working-context.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const ICONS_DIR = fileURLToPath(new URL("../node_modules/lucide-static/icons", import.meta.url));

export function createWebApp({
  store = new ConnectionStore(),
  clientManager = new ClientManager(),
  octoAccounts = store?.secrets ? new OctoAccountStore(store) : undefined,
  octoSession = () => readOctoSession(),
  octoFetch,
  allowRemote = process.env.TDOMS_MCP_UI_ALLOW_REMOTE === "1"
} = {}) {
  const app = express();
  // The page handles passwords, so it only answers requests addressed to this
  // machine. That also stops other sites from reaching it through DNS rebinding.
  app.use((req, res, next) => {
    const hostname = String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
    if (allowRemote || LOOPBACK_HOSTS.has(hostname)) return next();
    res.status(403).json({ error: "The TD/OMS MCP setup page only answers on this machine." });
  });
  app.use(express.json({ limit: "1mb" }));
  app.use("/icons", express.static(ICONS_DIR, { immutable: true, maxAge: "1d" }));

  app.get("/", (_req, res) => {
    res.type("html").send(renderPage());
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      dataDir: dataDir()
    });
  });

  app.get("/api/overview", async (_req, res, next) => {
    try {
      res.json({
        version: PACKAGE_VERSION,
        dataDir: dataDir(),
        context: await readWorkingContext(store),
        groups: toolGroupSummary(),
        octo: await octoStatus()
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/context", async (req, res, next) => {
    try {
      res.json({ context: await updateWorkingContext(store, { activeConnectionId: req.body?.activeConnectionId ?? null }) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/octo/sign-in", async (req, res, next) => {
    try {
      const accounts = requireOctoAccounts();
      const outcome = await signInToOcto({
        url: req.body?.url,
        username: req.body?.username,
        password: req.body?.password,
        code: req.body?.code,
        accounts,
        fetchImpl: octoFetch
      });
      res.json(outcome.ok ? { ok: true, octo: await octoStatus() } : outcome);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/octo/sign-out", async (_req, res, next) => {
    try {
      await requireOctoAccounts().clear();
      res.json({ ok: true, octo: await octoStatus() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/octo/probe", async (_req, res, next) => {
    try {
      res.json(await probeOcto({ accounts: requireOctoAccounts(), fetchImpl: octoFetch }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/octo/import-session", async (req, res, next) => {
    try {
      const imported = await importOctoConnection(store, {
        session: await octoSession(),
        username: req.body?.username || undefined
      });
      if (imported.imported) await updateWorkingContext(store, { activeConnectionId: imported.connection.id });
      res.json(imported);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/connections", async (_req, res, next) => {
    try {
      res.json({ connections: await store.listConnections() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/clients", async (_req, res, next) => {
    try {
      res.json({ clients: await clientManager.listClients() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/skill/archive", async (_req, res, next) => {
    try {
      const archive = await clientManager.createSkillArchive();
      res.set({
        "content-type": "application/zip",
        "content-disposition": "attachment; filename=tdoms-mcp-routing.zip",
        "content-length": archive.length
      });
      res.send(archive);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/clients/:id/install", async (req, res, next) => {
    try {
      const result = await clientManager.installClient(req.params.id, { confirm: req.body?.confirm === true });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/clients/install-detected", async (req, res, next) => {
    try {
      const result = await clientManager.installDetected({ confirm: req.body?.confirm === true });
      res.status(result.ok ? 200 : 207).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/clients/:id/install-skill", async (req, res, next) => {
    try {
      const result = await clientManager.installSkill(req.params.id, {
        confirm: req.body?.confirm === true,
        scope: req.body?.scope || "user"
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/clients/install-detected-skills", async (req, res, next) => {
    try {
      const result = await clientManager.installDetectedSkills({
        confirm: req.body?.confirm === true,
        scope: req.body?.scope || "user"
      });
      res.status(result.ok ? 200 : 207).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/connections", async (req, res, next) => {
    try {
      const connection = await store.upsertConnection(req.body);
      res.json({ connection });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/connections/:id", async (req, res, next) => {
    try {
      await store.deleteConnection(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/connections/:id/login", async (req, res, next) => {
    try {
      const connection = await store.getConnection(req.params.id, { includeSecrets: true });
      if (!connection) {
        res.status(404).json({ error: "Connection not found." });
        return;
      }

      const client = new TdomsClient(connection);
      const token = await client.login(req.body?.password);
      await store.saveToken(connection.id, token);
      if (req.body?.password && req.body?.remember === true) {
        await store.upsertConnection({ ...connection, password: req.body.password });
      }
      const systemInfo = await client.getSystemInfo(token);
      await store.updateStatus(connection.id, {
        lastStatus: "system-probe-ok",
        lastSystemProbeAt: new Date().toISOString()
      });
      res.json({
        ok: true,
        connection: await store.getConnection(connection.id),
        system: summarizeSystemInfo(systemInfo)
      });
    } catch (error) {
      try {
        await store.updateStatus(req.params.id, { lastStatus: "login-failed" });
      } catch {
        // Ignore status update failures so the useful login error is returned.
      }
      next(error);
    }
  });

  function requireOctoAccounts() {
    if (!octoAccounts) throw new Error("Octo sign-in is not available with this storage.");
    return octoAccounts;
  }

  async function octoStatus() {
    const account = octoAccounts ? await octoAccounts.get() : { signedIn: false };
    let local;
    try {
      const { accessToken, ...session } = await octoSession();
      local = { ...session, hasToken: Boolean(accessToken) };
    } catch (error) {
      local = { found: false, reason: error.message };
    }
    return { account, localSession: local };
  }

  app.use((error, _req, res, _next) => {
    res.status(500).json({
      error: error.message || String(error)
    });
  });

  return app;
}

export async function startWebServer({ host = DEFAULT_HOST, port = DEFAULT_PORT, store, clientManager } = {}) {
  const app = createWebApp({ store, clientManager });
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      resolve({ server, host, port });
    });
    server.on("error", reject);
  });
}
