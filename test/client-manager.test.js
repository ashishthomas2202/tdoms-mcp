import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "jsonc-parser";
import { ClientManager } from "../src/client-manager.js";

test("detects supported clients without exposing configuration contents", async () => {
  await withFixture(async ({ manager, paths }) => {
    const clients = await manager.listClients();
    const byId = Object.fromEntries(clients.map((client) => [client.id, client]));
    assert.equal(byId["ibm-bob"].detected, true);
    assert.equal(byId["ibm-bob"].configured, false);
    assert.equal(byId["ibm-bob"].configPath, paths.bobMcp);
    assert.equal(byId.codex.detected, true);
    assert.equal(byId.codex.configured, true);
    assert.equal(byId["claude-code"].detected, true);
    assert.equal(byId["claude-code"].name, "Claude Code sessions");
    assert.equal(byId["claude-desktop"].detected, true);
    assert.equal(byId["claude-desktop"].configPath, paths.claudeDesktopConfig);
    assert.equal(byId.vscode.detected, true);
    assert.equal(byId.kiro.detected, true);
    assert.equal(byId.kiro.environment.label, "Windows");
    assert.equal(byId.cursor.detected, false);
    assert.equal("configContents" in byId.codex, false);
  });
});

test("writes Kiro's documented user-level MCP configuration", async () => {
  await withFixture(async ({ manager, paths }) => {
    await manager.installClient("kiro", { confirm: true });
    const configured = parse(await fs.readFile(paths.kiroMcp, "utf8"));
    assert.equal(configured.mcpServers.tdoms.command, "C:\\Program Files\\nodejs\\node.exe");
    assert.equal(configured.mcpServers.tdoms.type, undefined);
    assert.equal(configured.mcpServers.tdoms.env.TDOMS_MCP_PROFILE, "core");
  });
});

test("writes IBM Bob's native MCP file and migrates existing legacy servers", async () => {
  await withFixture(async ({ manager, calls, paths }) => {
    await fs.mkdir(path.dirname(paths.bobLegacyMcp), { recursive: true });
    await fs.writeFile(paths.bobLegacyMcp, JSON.stringify({
      mcpServers: { "Octo-User-Context": { command: "bob", args: ["octo.cjs"] } }
    }));
    const result = await manager.installClient("ibm-bob", { confirm: true });
    const configured = parse(await fs.readFile(paths.bobMcp, "utf8"));
    assert.equal(result.ok, true);
    assert.equal(calls.length, 0);
    assert.equal(configured.mcpServers.tdoms.type, undefined);
    assert.equal(configured.mcpServers.tdoms.env.TDOMS_MCP_PROFILE, "core");
    assert.equal(configured.mcpServers["Octo-User-Context"].command, "bob");
  });
});

test("writes an empty VS Code user MCP file directly", async () => {
  await withFixture(async ({ manager, calls, paths }) => {
    const result = await manager.installClient("vscode", { confirm: true });
    const configured = parse(await fs.readFile(paths.vscodeMcp, "utf8"));
    assert.equal(result.ok, true);
    assert.equal(calls.length, 0);
    assert.equal(configured.servers.tdoms.type, "stdio");
    assert.equal(configured.servers.tdoms.env.TDOMS_MCP_PROFILE, "core");
  });
});

test("places Claude Code environment arguments after the server name", async () => {
  await withFixture(async ({ manager, calls }) => {
    await manager.installClient("claude-code", { confirm: true });
    assert.deepEqual(calls[0].args.slice(0, 8), [
      "mcp", "add", "--scope", "user", "tdoms", "--env", "TDOMS_MCP_PROFILE=core", "--"
    ]);
  });
});

test("requires explicit confirmation before changing a client", async () => {
  await withFixture(async ({ manager, calls }) => {
    await assert.rejects(manager.installClient("codex"), /confirm: true/);
    assert.equal(calls.length, 0);
  });
});

test("does not create configuration for a client that is not installed", async () => {
  await withFixture(async ({ manager }) => {
    await assert.rejects(manager.installClient("gemini-cli", { confirm: true }), /not installed in Windows/);
  });
});

test("updates Codex through its CLI and creates a configuration backup", async () => {
  await withFixture(async ({ manager, calls, paths }) => {
    const result = await manager.installClient("codex", { confirm: true });
    assert.equal(result.ok, true);
    assert.equal(result.backupPaths.length, 1);
    assert.equal((await fs.readFile(result.backupPaths[0], "utf8")).includes("[mcp_servers.tdoms]"), true);
    assert.deepEqual(calls.map((call) => call.args.slice(0, 3)), [
      ["mcp", "remove", "tdoms"],
      ["mcp", "add", "--env"]
    ]);
    assert.equal((await fs.readFile(paths.codexConfig, "utf8")).includes("[mcp_servers.tdoms]"), true);
  });
});

test("preserves JSONC comments when installing a direct-config client", async () => {
  await withFixture(async ({ manager, paths }) => {
    await fs.mkdir(path.dirname(paths.cursorConfig), { recursive: true });
    await fs.mkdir(paths.cursorApp, { recursive: true });
    await fs.writeFile(paths.cursorConfig, "{\n  // existing setting\n  \"other\": true\n}\n");
    const result = await manager.installClient("cursor", { confirm: true });
    const updated = await fs.readFile(paths.cursorConfig, "utf8");
    assert.equal(result.ok, true);
    assert.match(updated, /existing setting/);
    assert.equal(parse(updated).other, true);
    assert.equal(parse(updated).mcpServers.tdoms.env.TDOMS_MCP_PROFILE, "core");
  });
});

test("restores the original configuration when a client CLI fails", async () => {
  await withFixture(async ({ paths, options }) => {
    const original = await fs.readFile(paths.codexConfig, "utf8");
    const manager = new ClientManager({ ...options, runner: async (_executable, args) => {
      if (args[1] === "remove") await fs.writeFile(paths.codexConfig, "model = \"changed\"\n");
      else throw new Error("simulated failure");
    } });
    await assert.rejects(manager.installClient("codex", { confirm: true }), /configuration was restored/);
    assert.equal(await fs.readFile(paths.codexConfig, "utf8"), original);
  });
});

test("uses native macOS application-support paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdoms-client-mac-test-"));
  try {
    const bobMcp = path.join(root, ".bob", "settings", "mcp.json");
    await fs.mkdir(path.dirname(bobMcp), { recursive: true });
    await fs.writeFile(bobMcp, "{ \"mcpServers\": { \"tdoms\": {} } }");
    const manager = new ClientManager({ platform: "darwin", homedir: root, env: { PATH: "" } });
    const bob = (await manager.listClients()).find((client) => client.id === "ibm-bob");
    assert.equal(bob.configPath, bobMcp);
    assert.equal(bob.detected, true);
    assert.equal(bob.configured, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("keeps WSL registration inside the active distribution", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdoms-client-wsl-test-"));
  try {
    const kiroMcp = path.join(root, ".kiro", "settings", "mcp.json");
    await fs.mkdir(path.dirname(kiroMcp), { recursive: true });
    await fs.writeFile(kiroMcp, "{}\n");
    const manager = new ClientManager({
      platform: "linux",
      homedir: root,
      env: { PATH: "", WSL_DISTRO_NAME: "Ubuntu" },
      nodeCommand: "/usr/bin/node",
      serverEntry: "/opt/tdoms-mcp/src/index.js"
    });
    const kiro = (await manager.listClients()).find((client) => client.id === "kiro");
    assert.equal(kiro.environment.kind, "wsl");
    assert.match(kiro.environment.note, /not Windows applications/);
    await manager.installClient("kiro", { confirm: true });
    const configured = parse(await fs.readFile(kiroMcp, "utf8"));
    assert.equal(configured.mcpServers.tdoms.command, "/usr/bin/node");
    assert.equal(configured.mcpServers.tdoms.args[0], "/opt/tdoms-mcp/src/index.js");
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("uses documented Gemini, Zed, and OpenCode configuration shapes on Linux", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdoms-client-linux-test-"));
  try {
    const config = path.join(root, "config");
    const files = {
      gemini: path.join(root, ".gemini", "settings.json"),
      zed: path.join(config, "zed", "settings.json"),
      opencode: path.join(config, "opencode", "opencode.json")
    };
    for (const file of Object.values(files)) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, "{}\n");
    }
    const manager = new ClientManager({
      platform: "linux",
      homedir: root,
      env: { PATH: "", XDG_CONFIG_HOME: config },
      nodeCommand: "/usr/bin/node",
      serverEntry: "/opt/tdoms-mcp/src/index.js"
    });
    await manager.installClient("gemini-cli", { confirm: true });
    await manager.installClient("zed", { confirm: true });
    await manager.installClient("opencode", { confirm: true });
    assert.equal(parse(await fs.readFile(files.gemini, "utf8")).mcpServers.tdoms.command, "/usr/bin/node");
    assert.equal(parse(await fs.readFile(files.zed, "utf8")).context_servers.tdoms.command, "/usr/bin/node");
    const openCode = parse(await fs.readFile(files.opencode, "utf8")).mcp.tdoms;
    assert.equal(openCode.type, "local");
    assert.deepEqual(openCode.command, ["/usr/bin/node", "/opt/tdoms-mcp/src/index.js", "mcp"]);
    assert.equal(openCode.environment.TDOMS_MCP_PROFILE, "core");
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function withFixture(operation) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdoms-client-test-"));
  const home = path.join(root, "home");
  const appData = path.join(root, "roaming");
  const local = path.join(root, "local");
  const codexExtension = path.join(home, ".vscode", "extensions", "openai.chatgpt-1.0.0-win32-x64");
  const claudeExtension = path.join(home, ".vscode", "extensions", "anthropic.claude-code-1.0.0-win32-x64");
  const paths = {
    codexConfig: path.join(home, ".codex", "config.toml"),
    bobMcp: path.join(home, ".bob", "settings", "mcp.json"),
    bobLegacyMcp: path.join(home, ".bob", "settings", "mcp_settings.json"),
    claudeDesktopConfig: path.join(local, "Packages", "Claude_fixture", "LocalCache", "Roaming", "Claude", "claude_desktop_config.json"),
    vscodeMcp: path.join(appData, "Code", "User", "mcp.json"),
    claudeCodeConfig: path.join(home, ".claude.json"),
    kiroMcp: path.join(home, ".kiro", "settings", "mcp.json"),
    cursorConfig: path.join(home, ".cursor", "mcp.json"),
    cursorApp: path.join(local, "Programs", "cursor")
  };
  await fs.mkdir(path.join(local, "Packages", "Claude_fixture"), { recursive: true });
  await fs.mkdir(path.join(appData, "Claude", "claude-code", "2.1.0"), { recursive: true });
  await fs.writeFile(path.join(appData, "Claude", "claude-code", "2.1.0", "claude.exe"), "fixture");
  const files = [
    path.join(local, "Programs", "IBM Bob", "IBM Bob.exe"),
    path.join(local, "Programs", "Microsoft VS Code", "Code.exe"),
    path.join(local, "Programs", "Kiro", "Kiro.exe"),
    path.join(codexExtension, "bin", "windows-x86_64", "codex.exe"),
    path.join(claudeExtension, "resources", "native-binary", "claude.exe")
  ];
  for (const file of files) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "fixture");
  }
  await fs.mkdir(path.dirname(paths.codexConfig), { recursive: true });
  await fs.writeFile(paths.codexConfig, "model = \"demo\"\n\n[mcp_servers.tdoms]\ncommand = \"old\"\n");
  await fs.mkdir(path.join(appData, "Code", "User"), { recursive: true });
  await fs.writeFile(path.join(appData, "Code", "User", "mcp.json"), "");

  const calls = [];
  const options = {
    env: { APPDATA: appData, LOCALAPPDATA: local, PATH: "" },
    platform: "win32",
    homedir: home,
    nodeCommand: "C:\\Program Files\\nodejs\\node.exe",
    serverEntry: "C:\\tdoms-mcp\\src\\index.js"
  };
  const manager = new ClientManager({ ...options, runner: async (executable, args) => {
    calls.push({ executable, args });
    if (args[0] === "mcp" && args[1] === "remove") {
      await fs.writeFile(paths.codexConfig, "model = \"demo\"\n");
    }
    if (args[0] === "mcp" && args[1] === "add") {
      if (args.includes("--scope")) {
        await fs.writeFile(paths.claudeCodeConfig, JSON.stringify({ mcpServers: { tdoms: { command: "node" } } }));
      } else {
        await fs.appendFile(paths.codexConfig, "\n[mcp_servers.tdoms]\ncommand = \"node\"\n");
      }
    }
    return { stdout: "", stderr: "" };
  } });

  try {
    await operation({ manager, calls, paths, options });
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}
