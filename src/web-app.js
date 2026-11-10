import express from "express";
import { fileURLToPath } from "node:url";
import { ClientManager } from "./client-manager.js";
import { DEFAULT_HOST, DEFAULT_PORT, dataDir } from "./config.js";
import { ConnectionStore } from "./connection-store.js";
import { TdomsClient, summarizeSystemInfo } from "./tdoms-client.js";
import { renderPage } from "./ui-page.js";

const ICONS_DIR = fileURLToPath(new URL("../node_modules/lucide-static/icons", import.meta.url));

export function createWebApp({ store = new ConnectionStore(), clientManager = new ClientManager() } = {}) {
  const app = express();
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
