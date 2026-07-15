#!/usr/bin/env node
import { DEFAULT_HOST, DEFAULT_PORT, dataDir } from "./config.js";
import { ConnectionStore } from "./connection-store.js";
import { ClientManager } from "./client-manager.js";
import { startMcpServer } from "./mcp-server.js";
import { startWebServer } from "./web-app.js";
import { hardenDataDirectory } from "./storage-utils.js";

const command = process.argv[2] || "mcp";
const profileFlagIndex = process.argv.indexOf("--profile");
const profile = profileFlagIndex >= 0 ? process.argv[profileFlagIndex + 1] : process.env.TDOMS_MCP_PROFILE;

async function main() {
  const store = new ConnectionStore();
  const clientManager = new ClientManager();

  if (command === "ui") {
    const { host, port } = await startWebServer({ store, clientManager });
    console.log(`TD/OMS MCP UI: http://${host}:${port}`);
    console.log(`Data directory: ${dataDir()}`);
    return;
  }

  if (command === "dev") {
    const { host, port } = await startWebServer({ store, clientManager });
    console.error(`TD/OMS MCP UI: http://${host}:${port}`);
    await startMcpServer({ store, profile });
    return;
  }

  if (command === "smoke") {
    console.log(JSON.stringify({
      ok: true,
      dataDir: dataDir(),
      connections: await store.listConnections()
    }, null, 2));
    return;
  }

  if (command === "secure-storage") {
    const security = await hardenDataDirectory(dataDir());
    console.log(JSON.stringify({ ok: true, dataDir: dataDir(), security }, null, 2));
    return;
  }

  if (command === "clients") {
    console.log(JSON.stringify({ clients: await clientManager.listClients() }, null, 2));
    return;
  }

  if (command === "install-client") {
    const clientId = process.argv[3];
    if (!clientId) throw new Error("Client id is required. Run `tdoms-mcp clients` to list detected clients.");
    const result = await clientManager.installClient(clientId, { confirm: process.argv.includes("--confirm") });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "install-detected") {
    const result = await clientManager.installDetected({ confirm: process.argv.includes("--confirm") });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === "mcp") {
    await startMcpServer({ store, profile });
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Expected one of: mcp, ui, dev, smoke, secure-storage, clients, install-client, install-detected");
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
