#!/usr/bin/env node
import { DEFAULT_HOST, DEFAULT_PORT, dataDir } from "./config.js";
import { ConnectionStore } from "./connection-store.js";
import { ClientManager } from "./client-manager.js";
import { startMcpServer } from "./mcp-server.js";
import { startWebServer } from "./web-app.js";
import { hardenDataDirectory } from "./storage-utils.js";
import { loginFromCli, parseFlags } from "./cli-login.js";
import { DEFAULT_HTTP_PORT, startHttpServer } from "./http-server.js";
import { importOctoConnection, readOctoSession } from "./octo-session.js";
import { TOOL_GROUPS } from "./tool-groups.js";
import { updateWorkingContext } from "./working-context.js";

const command = process.argv[2] || "mcp";
const profileFlagIndex = process.argv.indexOf("--profile");
const profile = profileFlagIndex >= 0 ? process.argv[profileFlagIndex + 1] : process.env.TDOMS_MCP_PROFILE;
const flags = parseFlags(process.argv.slice(3));
const groups = typeof flags.groups === "string" ? flags.groups : process.env.TDOMS_MCP_GROUPS;

async function main() {
  if (["--help", "-h", "help"].includes(command)) {
    printHelp();
    return;
  }

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

  if (command === "skills") {
    const clients = await clientManager.listClients();
    console.log(JSON.stringify({
      environment: clients[0]?.environment,
      skills: clients.map(({ id, name, detected, skill }) => ({ id, name, detected, skill }))
    }, null, 2));
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

  if (command === "install-skill") {
    const clientId = process.argv[3];
    if (!clientId) throw new Error("Client id is required. Run `tdoms-mcp skills` to list skill targets.");
    const result = await clientManager.installSkill(clientId, {
      confirm: process.argv.includes("--confirm"),
      scope: flagValue("--scope") || "user"
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "install-detected-skills") {
    const result = await clientManager.installDetectedSkills({
      confirm: process.argv.includes("--confirm"),
      scope: flagValue("--scope") || "user"
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === "mcp") {
    await startMcpServer({ store, profile, groups });
    return;
  }

  if (command === "http") {
    const started = await startHttpServer({
      store,
      profile,
      groups,
      host: typeof flags.host === "string" ? flags.host : DEFAULT_HOST,
      port: Number.parseInt(flags.port || process.env.TDOMS_MCP_HTTP_PORT || DEFAULT_HTTP_PORT, 10)
    });
    console.error(`TD/OMS MCP server running on ${started.url}`);
    console.error(`Send "Authorization: Bearer <token>". The token is read from ${started.tokenSource}.`);
    return;
  }

  if (command === "groups") {
    console.log(JSON.stringify({ groups: TOOL_GROUPS }, null, 2));
    return;
  }

  if (command === "login") {
    console.log(JSON.stringify(await loginFromCli({ store, flags }), null, 2));
    return;
  }

  if (command === "import-octo") {
    const session = await readOctoSession();
    if (!flags.confirm) {
      const { accessToken, ...preview } = session;
      console.log(JSON.stringify({ ok: true, dryRun: true, octo: { ...preview, hasToken: Boolean(accessToken) }, next: "Re-run with --confirm to save this as a connection." }, null, 2));
      return;
    }
    const imported = await importOctoConnection(store, {
      session,
      username: typeof flags.username === "string" ? flags.username : undefined,
      name: typeof flags.name === "string" ? flags.name : undefined,
      reuseToken: flags["no-token"] !== true
    });
    if (imported.imported) await updateWorkingContext(store, { activeConnectionId: imported.connection.id });
    console.log(JSON.stringify(imported, null, 2));
    if (!imported.ok) process.exitCode = 1;
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp(console.error);
  process.exit(1);
}

function printHelp(write = console.log) {
  write(`TD/OMS MCP

Usage:
  tdoms-mcp ui
  tdoms-mcp clients
  tdoms-mcp skills
  tdoms-mcp install-client <id> --confirm
  tdoms-mcp install-detected --confirm
  tdoms-mcp install-skill <id> [--scope user|workspace] --confirm
  tdoms-mcp install-detected-skills [--scope user|workspace] --confirm
  tdoms-mcp mcp [--profile core|full] [--groups tasks,source,...]
  tdoms-mcp http [--port 3738] [--profile core|full] [--groups ...]
  tdoms-mcp groups
  tdoms-mcp login --host <host> --port <port> --username <user> [--library OMS] [--name <name>]
  tdoms-mcp import-octo [--username <user>] --confirm
  tdoms-mcp smoke
  tdoms-mcp secure-storage
  tdoms-mcp --help`);
}

function flagValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
