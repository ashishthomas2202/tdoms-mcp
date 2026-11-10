import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { applyEdits, modify, parse } from "jsonc-parser";
import { ZipFile } from "yazl";
import { atomicWriteFile, withFileLock } from "./storage-utils.js";

const execFileAsync = promisify(execFile);
const SERVER_NAME = "tdoms";
const SKILL_NAME = "tdoms-mcp-routing";
const DEFAULT_SERVER_ENTRY = fileURLToPath(new URL("./index.js", import.meta.url));
const DEFAULT_SKILL_ROOT = fileURLToPath(new URL(`../skills/${SKILL_NAME}`, import.meta.url));

export class ClientManager {
  constructor({
    env = process.env,
    platform = process.platform,
    homedir = os.homedir(),
    workspace = process.cwd(),
    nodeCommand = process.execPath,
    serverEntry = DEFAULT_SERVER_ENTRY,
    skillRoot = DEFAULT_SKILL_ROOT,
    runner = runExecutable
  } = {}) {
    this.env = env;
    this.platform = platform;
    this.homedir = homedir;
    this.workspace = path.resolve(workspace);
    this.nodeCommand = nodeCommand;
    this.serverEntry = serverEntry;
    this.skillRoot = skillRoot;
    this.runner = runner;
    this.runtime = describeRuntime(platform, env);
  }

  async listClients() {
    const definitions = await this.#definitions();
    return Promise.all(definitions.map(async (definition) => {
      const executable = await firstExistingFile(definition.executableCandidates);
      const detectedByConfig = await anyPathExists(definition.configPaths);
      const configured = await isConfigured(definition);
      const detected = Boolean(executable || detectedByConfig || await anyPathExists(definition.appCandidates));
      const skill = await inspectSkill(definition.skill, this.skillRoot);
      return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        detected,
        configured,
        installable: detected && (definition.strategy === "json" || Boolean(executable)),
        executable,
        configPath: definition.configPaths[0],
        strategy: definition.strategy,
        environment: this.runtime,
        restartRequired: definition.restartRequired,
        status: configured ? "configured" : detected ? "detected" : "not-detected",
        skill
      };
    }));
  }

  async installSkill(id, { confirm = false, scope = "user" } = {}) {
    if (confirm !== true) {
      throw new Error("Refusing to install an agent skill without confirm: true.");
    }
    if (!["user", "workspace"].includes(scope)) {
      throw new Error("Skill scope must be either user or workspace.");
    }

    const definition = (await this.#definitions()).find((item) => item.id === id);
    if (!definition) throw new Error(`Unsupported MCP client: ${id}`);
    if (!definition.skill.supported) {
      throw new Error(`${definition.name} does not have a verified filesystem skill installer. ${definition.skill.guidance}`.trim());
    }
    const detected = Boolean(
      await firstExistingFile(definition.executableCandidates)
      || await anyPathExists(definition.configPaths)
      || await anyPathExists(definition.appCandidates)
    );
    if (!detected) throw new Error(`${definition.name} is not installed in ${this.runtime.label}.`);

    const targets = skillTargets(definition.skill, scope);
    const results = [];
    for (const target of targets) {
      results.push({
        ...target,
        ...await installSkillDirectory(this.skillRoot, target.path, this.platform)
      });
    }
    return {
      ok: true,
      clientId: definition.id,
      clientName: definition.name,
      scope,
      skillName: SKILL_NAME,
      skillPath: results[0].path,
      skillPaths: results.map((result) => result.path),
      backupPath: results[0].backupPath,
      backupPaths: results.map((result) => result.backupPath).filter(Boolean),
      targets: results,
      installed: true,
      current: true,
      restartRequired: definition.skill.restartRequired
    };
  }

  async createSkillArchive() {
    if (!await pathExists(path.join(this.skillRoot, "SKILL.md"))) {
      throw new Error(`Bundled skill is incomplete: ${this.skillRoot}`);
    }
    return createZipArchive(this.skillRoot);
  }

  async installDetectedSkills({ confirm = false, scope = "user" } = {}) {
    if (confirm !== true) {
      throw new Error("Refusing to install agent skills without confirm: true.");
    }
    if (!["user", "workspace"].includes(scope)) {
      throw new Error("Skill scope must be either user or workspace.");
    }
    const clients = await this.listClients();
    const targets = clients.filter((client) => client.detected && client.skill.supported && !client.skill[scope].current);
    const results = [];
    for (const client of targets) {
      try {
        results.push(await this.installSkill(client.id, { confirm: true, scope }));
      } catch (error) {
        results.push({ ok: false, clientId: client.id, clientName: client.name, error: error.message });
      }
    }
    return {
      ok: results.every((result) => result.ok),
      environment: this.runtime,
      scope,
      installed: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results
    };
  }

  async installDetected({ confirm = false } = {}) {
    if (confirm !== true) {
      throw new Error("Refusing to modify MCP client configurations without confirm: true.");
    }
    const clients = await this.listClients();
    const targets = clients.filter((client) => client.detected && client.installable && !client.configured);
    const results = [];
    for (const client of targets) {
      try {
        results.push(await this.installClient(client.id, { confirm: true }));
      } catch (error) {
        results.push({ ok: false, clientId: client.id, clientName: client.name, error: error.message });
      }
    }
    return {
      ok: results.every((result) => result.ok),
      environment: this.runtime,
      configured: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results
    };
  }

  async installClient(id, { confirm = false } = {}) {
    if (confirm !== true) {
      throw new Error("Refusing to modify an MCP client configuration without confirm: true.");
    }

    const definition = (await this.#definitions()).find((item) => item.id === id);
    if (!definition) throw new Error(`Unsupported MCP client: ${id}`);
    const executable = await firstExistingFile(definition.executableCandidates);
    const detected = Boolean(executable || await anyPathExists(definition.configPaths) || await anyPathExists(definition.appCandidates));
    if (!detected) {
      throw new Error(`${definition.name} is not installed in ${this.runtime.label}.`);
    }
    if (definition.strategy !== "json" && !executable) {
      throw new Error(`${definition.name} was not detected with an installable CLI.`);
    }

    const snapshot = await snapshotFiles(definition.configPaths);
    const backupPaths = await writeBackups(snapshot);
    try {
      if (definition.strategy === "json") {
        await installJsonClient(
          definition.configPaths[0],
          definition.container,
          formatServerDefinition(this.#serverDefinition(), definition.format),
          definition.seedConfigPaths
        );
      } else {
        await this.#installWithCli(definition, executable, await isConfigured(definition));
      }
      if (!await isConfigured(definition)) {
        throw new Error("The client did not persist the TD/OMS MCP server.");
      }
    } catch (error) {
      await restoreSnapshot(snapshot);
      throw new Error(`${definition.name} installation failed and its configuration was restored: ${error.message}`);
    }

    return {
      ok: true,
      clientId: definition.id,
      clientName: definition.name,
      backupPaths,
      restartRequired: definition.restartRequired,
      configured: true
    };
  }

  #serverDefinition() {
    return {
      type: "stdio",
      command: this.nodeCommand,
      args: [this.serverEntry, "mcp"],
      env: { TDOMS_MCP_PROFILE: "core" }
    };
  }

  async #installWithCli(definition, executable, configured) {
    const server = this.#serverDefinition();
    if (definition.strategy === "codex") {
      if (configured) await this.runner(executable, ["mcp", "remove", SERVER_NAME]);
      await this.runner(executable, ["mcp", "add", "--env", "TDOMS_MCP_PROFILE=core", SERVER_NAME, "--", server.command, ...server.args]);
      return;
    }

    if (definition.strategy === "claude") {
      if (configured) await this.runner(executable, ["mcp", "remove", "--scope", "user", SERVER_NAME]);
      await this.runner(executable, ["mcp", "add", "--scope", "user", SERVER_NAME, "--env", "TDOMS_MCP_PROFILE=core", "--", server.command, ...server.args]);
      return;
    }

    const payload = JSON.stringify({ name: SERVER_NAME, type: "stdio", ...server });
    await this.runner(executable, ["--add-mcp", payload]);
  }

  async #definitions() {
    const paths = platformPaths(this.platform, this.env, this.homedir);
    const vscodeExtensions = await extensionDirectories(paths.vscodeExtensions);
    const windowsPackages = await extensionDirectories(paths.windowsPackages);
    const claudeDesktopCodeVersions = await extensionDirectories(paths.claudeDesktopCodeRoot);
    const codexExtension = newestMatching(vscodeExtensions, "openai.chatgpt-");
    const claudeExtension = newestMatching(vscodeExtensions, "anthropic.claude-code-");
    const copilotExtension = newestMatching(vscodeExtensions, "github.copilot-");
    const claudeStorePackage = newestMatching(windowsPackages, "Claude_");
    const claudeDesktopCodeVersion = newestMatching(claudeDesktopCodeVersions, "");
    const claudeDesktopConfig = claudeStorePackage
      ? path.join(claudeStorePackage, "LocalCache", "Roaming", "Claude", "claude_desktop_config.json")
      : paths.claudeDesktopConfig;
    const commandCandidates = async (name, fixed = []) => compact([...fixed, await findOnPath(name, this.platform, this.env)]);

    const definitions = [
      {
        id: "ibm-bob",
        name: "IBM Bob",
        description: "IBM Bob global MCP configuration",
        strategy: "json",
        executableCandidates: await commandCandidates("bobide"),
        appCandidates: compact([paths.bobApp]),
        configPaths: [paths.bobMcp],
        seedConfigPaths: compact([paths.bobLegacyMcp, paths.bobExtensionLegacyMcp]),
        container: "mcpServers",
        format: "mcp",
        containers: ["mcpServers"],
        restartRequired: false
      },
      {
        id: "codex",
        name: "Codex",
        description: "Codex app and CLI",
        strategy: "codex",
        executableCandidates: compact([
          codexExtension && path.join(codexExtension, "bin", platformBinaryDir(this.platform), executableName("codex", this.platform)),
          await findOnPath("codex", this.platform, this.env)
        ]),
        appCandidates: [paths.codexHome],
        configPaths: [paths.codexConfig],
        tomlTable: "mcp_servers.tdoms",
        restartRequired: true
      },
      {
        id: "claude-code",
        name: "Claude Code sessions",
        description: "Code sessions in Claude Desktop and the VS Code extension",
        strategy: "claude",
        executableCandidates: compact([
          claudeDesktopCodeVersion && path.join(claudeDesktopCodeVersion, executableName("claude", this.platform)),
          claudeExtension && path.join(claudeExtension, "resources", "native-binary", executableName("claude", this.platform)),
          await findOnPath("claude", this.platform, this.env)
        ]),
        appCandidates: compact([claudeExtension]),
        configPaths: [paths.claudeCodeConfig],
        containers: ["mcpServers"],
        restartRequired: true
      },
      {
        id: "vscode",
        name: "Visual Studio Code",
        description: "VS Code user profile",
        strategy: "json",
        executableCandidates: await commandCandidates("code", compact([paths.vscodeExecutable])),
        appCandidates: compact([paths.vscodeApp]),
        configPaths: [paths.vscodeMcp],
        container: "servers",
        format: "vscode",
        containers: ["servers"],
        restartRequired: true
      },
      {
        id: "claude-desktop",
        name: "Claude Desktop chat",
        description: "Desktop chat MCP configuration; Code sessions use the separate row above",
        strategy: "json",
        executableCandidates: [],
        appCandidates: compact([paths.claudeDesktopApp, claudeStorePackage]),
        configPaths: [claudeDesktopConfig],
        container: "mcpServers",
        format: "mcp",
        containers: ["mcpServers"],
        restartRequired: true
      },
      {
        id: "cursor",
        name: "Cursor",
        description: "Cursor global MCP configuration",
        strategy: "json",
        executableCandidates: await commandCandidates("cursor"),
        appCandidates: compact([paths.cursorApp]),
        configPaths: [paths.cursorMcp],
        container: "mcpServers",
        format: "mcp",
        containers: ["mcpServers"],
        restartRequired: true
      },
      {
        id: "windsurf",
        name: "Windsurf",
        description: "Windsurf global MCP configuration",
        strategy: "json",
        executableCandidates: await commandCandidates("windsurf"),
        appCandidates: compact([paths.windsurfApp]),
        configPaths: [paths.windsurfMcp],
        container: "mcpServers",
        format: "mcp",
        containers: ["mcpServers"],
        restartRequired: true
      },
      {
        id: "kiro",
        name: "Kiro",
        description: "Kiro IDE and CLI user configuration",
        strategy: "json",
        executableCandidates: await commandCandidates("kiro", compact([paths.kiroExecutable])),
        appCandidates: compact([paths.kiroApp, paths.kiroHome]),
        configPaths: [paths.kiroMcp],
        container: "mcpServers",
        format: "mcp",
        containers: ["mcpServers"],
        restartRequired: false
      },
      {
        id: "gemini-cli",
        name: "Gemini CLI",
        description: "Gemini CLI user settings",
        strategy: "json",
        executableCandidates: await commandCandidates("gemini"),
        appCandidates: compact([paths.geminiHome]),
        configPaths: [paths.geminiConfig],
        container: "mcpServers",
        format: "mcp",
        containers: ["mcpServers"],
        restartRequired: true
      },
      {
        id: "zed",
        name: "Zed",
        description: "Zed Agent user settings",
        strategy: "json",
        executableCandidates: await commandCandidates("zed"),
        appCandidates: compact([paths.zedApp, paths.zedHome]),
        configPaths: [paths.zedConfig],
        container: "context_servers",
        format: "zed",
        containers: ["context_servers"],
        restartRequired: true
      },
      {
        id: "opencode",
        name: "OpenCode",
        description: "OpenCode global configuration",
        strategy: "json",
        executableCandidates: await commandCandidates("opencode"),
        appCandidates: compact([paths.openCodeHome]),
        configPaths: [paths.openCodeConfig],
        container: "mcp",
        format: "opencode",
        containers: ["mcp"],
        restartRequired: true
      }
    ];
    return definitions.map((definition) => ({
      ...definition,
      skill: skillDefinition(definition.id, this.homedir, this.workspace, {
        hasVsCodeCodex: Boolean(codexExtension),
        hasVsCodeClaude: Boolean(claudeExtension),
        hasVsCodeCopilot: Boolean(copilotExtension)
      })
    }));
  }
}

function skillDefinition(clientId, home, workspace, {
  hasVsCodeCodex = false,
  hasVsCodeClaude = false,
  hasVsCodeCopilot = false
} = {}) {
  const definitions = {
    "ibm-bob": {
      userPath: path.join(home, ".bob", "skills", SKILL_NAME),
      workspacePath: path.join(workspace, ".bob", "skills", SKILL_NAME),
      restartRequired: false,
      guidance: "IBM Bob must be in Advanced mode before the skill appears."
    },
    codex: {
      userPath: path.join(home, ".agents", "skills", SKILL_NAME),
      workspacePath: path.join(workspace, ".agents", "skills", SKILL_NAME),
      restartRequired: true,
      guidance: "Start a new Codex session after installation."
    },
    "claude-code": {
      userPath: path.join(home, ".claude", "skills", SKILL_NAME),
      workspacePath: path.join(workspace, ".claude", "skills", SKILL_NAME),
      restartRequired: true,
      guidance: "Start a new Claude Code session after installation."
    },
    vscode: {
      userPath: path.join(home, ".copilot", "skills", SKILL_NAME),
      workspacePath: path.join(workspace, ".github", "skills", SKILL_NAME),
      restartRequired: true,
      guidance: "Reload the VS Code window or start a new chat after installation."
    },
    "gemini-cli": {
      userPath: path.join(home, ".gemini", "skills", SKILL_NAME),
      workspacePath: path.join(workspace, ".gemini", "skills", SKILL_NAME),
      restartRequired: false,
      guidance: "Run /skills reload in an existing Gemini CLI session."
    },
    kiro: {
      userPath: path.join(home, ".kiro", "skills", SKILL_NAME),
      workspacePath: path.join(workspace, ".kiro", "skills", SKILL_NAME),
      restartRequired: false,
      guidance: "Kiro detects skills in its Agent Steering & Skills panel and as slash commands."
    }
  };
  if (clientId === "vscode") {
    const userTargets = compact([
      hasVsCodeCodex && { label: "Codex", path: path.join(home, ".agents", "skills", SKILL_NAME) },
      hasVsCodeClaude && { label: "Claude Code", path: path.join(home, ".claude", "skills", SKILL_NAME) },
      hasVsCodeCopilot && { label: "GitHub Copilot", path: path.join(home, ".copilot", "skills", SKILL_NAME) }
    ]);
    const workspaceTargets = compact([
      hasVsCodeCodex && { label: "Codex", path: path.join(workspace, ".agents", "skills", SKILL_NAME) },
      hasVsCodeClaude && { label: "Claude Code", path: path.join(workspace, ".claude", "skills", SKILL_NAME) },
      hasVsCodeCopilot && { label: "GitHub Copilot", path: path.join(workspace, ".github", "skills", SKILL_NAME) }
    ]);
    if (!userTargets.length) {
      return {
        supported: false,
        guidance: "No compatible Codex, Claude Code, or GitHub Copilot extension was detected in VS Code."
      };
    }
    return {
      supported: true,
      userTargets,
      workspaceTargets,
      restartRequired: true,
      guidance: `Installs for detected VS Code agents: ${userTargets.map((target) => target.label).join(", ")}.`
    };
  }
  if (definitions[clientId]) return { supported: true, ...definitions[clientId] };
  if (clientId === "claude-desktop") {
    return {
      supported: false,
      downloadable: true,
      guidance: "Download the ZIP, then use Customize > Skills > Create skill > Upload a skill in Claude Desktop."
    };
  }
  return { supported: false, guidance: "No verified native Agent Skills directory is available for this client." };
}

async function inspectSkill(definition, sourceRoot) {
  if (!definition.supported) {
    return { supported: false, downloadable: definition.downloadable === true, guidance: definition.guidance };
  }
  const inspect = async (target) => {
    const installed = await pathExists(path.join(target.path, "SKILL.md"));
    return {
      ...target,
      installed,
      current: installed && await skillFilesMatch(sourceRoot, target.path)
    };
  };
  const inspectScope = async (scope) => {
    const targets = await Promise.all(skillTargets(definition, scope).map(inspect));
    return {
      path: targets[0]?.path,
      paths: targets.map((target) => target.path),
      installed: targets.length > 0 && targets.every((target) => target.installed),
      installedAny: targets.some((target) => target.installed),
      current: targets.length > 0 && targets.every((target) => target.current),
      targets
    };
  };
  return {
    supported: true,
    guidance: definition.guidance,
    restartRequired: definition.restartRequired,
    user: await inspectScope("user"),
    workspace: await inspectScope("workspace")
  };
}

function skillTargets(definition, scope) {
  const configured = definition[`${scope}Targets`];
  if (configured?.length) {
    const seen = new Set();
    return configured.filter((target) => {
      const normalized = path.resolve(target.path).toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }
  const skillPath = definition[`${scope}Path`];
  return skillPath ? [{ label: definition.label || "Agent", path: skillPath }] : [];
}

async function installSkillDirectory(source, destination, platform) {
  if (!await pathExists(path.join(source, "SKILL.md"))) {
    throw new Error(`Bundled skill is incomplete: ${source}`);
  }
  if (path.basename(destination) !== SKILL_NAME) {
    throw new Error(`Refusing to write an unexpected skill destination: ${destination}`);
  }

  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  return withFileLock(path.join(parent, `.${SKILL_NAME}.install`), async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const staged = path.join(parent, `.${SKILL_NAME}.${process.pid}.${crypto.randomUUID()}.tmp`);
    const rollback = path.join(parent, `.${SKILL_NAME}.${process.pid}.${crypto.randomUUID()}.rollback`);
    const existed = await pathExists(destination);
    const backupPath = existed ? `${destination}.tdoms-backup-${stamp}` : undefined;
    if (platform === "win32") {
      if (backupPath) await fs.cp(destination, backupPath, { recursive: true, errorOnExist: true });
      try {
        await fs.cp(source, destination, { recursive: true, force: true });
        if (!await skillFilesMatch(source, destination)) {
          throw new Error("The copied skill did not pass verification.");
        }
        return { backupPath };
      } catch (error) {
        if (backupPath) {
          try {
            await fs.cp(backupPath, destination, { recursive: true, force: true });
          } catch (restoreError) {
            throw new Error(`${error.message} The backup remains at ${backupPath} because automatic restoration failed: ${restoreError.message}`);
          }
        } else {
          await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
        }
        throw error;
      }
    }

    try {
      await fs.cp(source, staged, { recursive: true, errorOnExist: true });
      if (backupPath) await fs.cp(destination, backupPath, { recursive: true, errorOnExist: true });
      if (existed) await renameDirectory(destination, rollback);
      await renameDirectory(staged, destination);
      await fs.rm(rollback, { recursive: true, force: true });
      return { backupPath };
    } catch (error) {
      await fs.rm(staged, { recursive: true, force: true }).catch(() => {});
      if (await pathExists(rollback) && !await pathExists(destination)) {
        try {
          await renameDirectory(rollback, destination);
        } catch (restoreError) {
          throw new Error(`${error.message} The previous skill remains at ${rollback} because automatic restoration failed: ${restoreError.message}`);
        }
      }
      throw error;
    }
  }, { privateDirectory: false });
}

async function skillFilesMatch(source, destination) {
  async function compare(sourceDirectory, destinationDirectory) {
    const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = path.join(sourceDirectory, entry.name);
      const destinationPath = path.join(destinationDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!await pathExists(destinationPath) || !await compare(sourcePath, destinationPath)) return false;
      } else if (entry.isFile()) {
        try {
          const [sourceContent, destinationContent] = await Promise.all([
            fs.readFile(sourcePath),
            fs.readFile(destinationPath)
          ]);
          if (!sourceContent.equals(destinationContent)) return false;
        } catch {
          return false;
        }
      } else {
        return false;
      }
    }
    return true;
  }
  return compare(source, destination).catch(() => false);
}

async function createZipArchive(source) {
  const zip = new ZipFile();
  async function addDirectory(directory, relative = "") {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(relative, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await addDirectory(absolutePath, relativePath);
      else if (entry.isFile()) zip.addFile(absolutePath, path.posix.join(SKILL_NAME, relativePath));
      else throw new Error(`Unsupported entry in skill directory: ${absolutePath}`);
    }
  }
  await addDirectory(source);
  return new Promise((resolve, reject) => {
    const chunks = [];
    zip.outputStream.on("data", (chunk) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.end();
  });
}

async function renameDirectory(source, destination) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      if (!["EACCES", "EBUSY", "EPERM"].includes(error.code) || attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 + attempt * 5));
    }
  }
}

export async function runExecutable(executable, args) {
  const { stdout, stderr } = await execFileAsync(executable, args, {
    windowsHide: true,
    shell: process.platform === "win32" && /\.(?:bat|cmd)$/i.test(executable),
    timeout: 30000,
    maxBuffer: 1024 * 1024
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

async function installJsonClient(configPath, container, server, seedConfigPaths = []) {
  await withFileLock(configPath, async () => {
    let existing = await readText(configPath, "");
    if (!existing.trim()) {
      for (const seedPath of seedConfigPaths) {
        existing = await readText(seedPath, "");
        if (existing.trim()) break;
      }
    }
    const original = existing.trim() ? existing : "{}";
    const errors = [];
    parse(original, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length) throw new Error(`Cannot safely parse ${configPath}; no changes were made.`);
    const edits = modify(original, [container, SERVER_NAME], server, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" }
    });
    await atomicWriteFile(configPath, `${applyEdits(original, edits).trimEnd()}\n`);
  });
}

function formatServerDefinition(server, format = "mcp") {
  if (format === "vscode") return server;
  if (format === "opencode") {
    return {
      type: "local",
      command: [server.command, ...server.args],
      enabled: true,
      environment: server.env
    };
  }
  const { type: _type, ...standard } = server;
  return standard;
}

async function isConfigured(definition) {
  if (definition.tomlTable) {
    const text = await readText(definition.configPaths[0], "");
    const escaped = definition.tomlTable.replaceAll(".", "\\.");
    return new RegExp(`^\\s*\\[${escaped}\\]\\s*$`, "m").test(text);
  }

  for (const configPath of definition.configPaths) {
    const text = await readText(configPath, "");
    if (!text.trim()) continue;
    const errors = [];
    const parsed = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length || !parsed) continue;
    for (const container of definition.containers || []) {
      if (parsed[container]?.[SERVER_NAME]) return true;
    }
  }
  return false;
}

async function snapshotFiles(paths) {
  return Promise.all(paths.map(async (filePath) => ({
    filePath,
    existed: await pathExists(filePath),
    content: await readText(filePath, "")
  })));
}

async function writeBackups(snapshot) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backups = [];
  for (const file of snapshot) {
    if (!file.existed) continue;
    const backupPath = `${file.filePath}.tdoms-backup-${stamp}`;
    await atomicWriteFile(backupPath, file.content);
    backups.push(backupPath);
  }
  return backups;
}

async function restoreSnapshot(snapshot) {
  for (const file of snapshot) {
    if (file.existed) await atomicWriteFile(file.filePath, file.content);
    else await fs.rm(file.filePath, { force: true }).catch(() => {});
  }
}

async function firstExistingFile(paths) {
  for (const candidate of paths || []) {
    if (!candidate) continue;
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") continue;
    }
  }
  return undefined;
}

async function anyPathExists(paths) {
  for (const candidate of paths || []) if (candidate && await pathExists(candidate)) return true;
  return false;
}

async function pathExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function readText(filePath, fallback) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function extensionDirectories(root) {
  if (!root) return [];
  try {
    return (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function newestMatching(directories, prefix) {
  return directories.filter((directory) => path.basename(directory).startsWith(prefix)).sort().at(-1);
}

async function findOnPath(name, platform, env) {
  const extensions = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const directory of String(env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory.replace(/^"|"$/g, ""), `${name}${extension}`);
      if (await pathExists(candidate)) return candidate;
    }
  }
  return undefined;
}

function platformPaths(platform, env, home) {
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return {
      vscodeExtensions: path.join(home, ".vscode", "extensions"),
      windowsPackages: path.join(local, "Packages"),
      codexHome: env.CODEX_HOME || path.join(home, ".codex"),
      codexConfig: path.join(env.CODEX_HOME || path.join(home, ".codex"), "config.toml"),
      claudeCodeConfig: path.join(home, ".claude.json"),
      claudeDesktopCodeRoot: path.join(appData, "Claude", "claude-code"),
      bobExecutable: path.join(local, "Programs", "IBM Bob", "IBM Bob.exe"),
      bobApp: path.join(local, "Programs", "IBM Bob"),
      bobMcp: path.join(home, ".bob", "settings", "mcp.json"),
      bobLegacyMcp: path.join(home, ".bob", "settings", "mcp_settings.json"),
      bobExtensionLegacyMcp: path.join(appData, "IBM Bob", "User", "globalStorage", "ibm.bob-code", "settings", "mcp_settings.json"),
      vscodeExecutable: path.join(local, "Programs", "Microsoft VS Code", "Code.exe"),
      vscodeApp: path.join(local, "Programs", "Microsoft VS Code"),
      vscodeMcp: path.join(appData, "Code", "User", "mcp.json"),
      claudeDesktopApp: path.join(local, "Programs", "Claude"),
      claudeDesktopConfig: path.join(appData, "Claude", "claude_desktop_config.json"),
      cursorApp: path.join(local, "Programs", "cursor"),
      cursorMcp: path.join(home, ".cursor", "mcp.json"),
      windsurfApp: path.join(local, "Programs", "Windsurf"),
      windsurfMcp: path.join(home, ".codeium", "windsurf", "mcp_config.json"),
      kiroExecutable: path.join(local, "Programs", "Kiro", "Kiro.exe"),
      kiroApp: path.join(local, "Programs", "Kiro"),
      kiroHome: path.join(home, ".kiro"),
      kiroMcp: path.join(home, ".kiro", "settings", "mcp.json"),
      geminiHome: path.join(home, ".gemini"),
      geminiConfig: path.join(home, ".gemini", "settings.json"),
      zedApp: undefined,
      zedHome: path.join(appData, "Zed"),
      zedConfig: path.join(appData, "Zed", "settings.json"),
      openCodeHome: path.join(home, ".config", "opencode"),
      openCodeConfig: path.join(home, ".config", "opencode", "opencode.json")
    };
  }

  const config = env.XDG_CONFIG_HOME || path.join(home, ".config");
  const applications = platform === "darwin" ? "/Applications" : undefined;
  const bobUserData = platform === "darwin" ? path.join(home, "Library", "Application Support", "IBM Bob") : path.join(config, "IBM Bob");
  return {
    vscodeExtensions: path.join(home, ".vscode", "extensions"),
    windowsPackages: undefined,
    codexHome: env.CODEX_HOME || path.join(home, ".codex"),
    codexConfig: path.join(env.CODEX_HOME || path.join(home, ".codex"), "config.toml"),
    claudeCodeConfig: path.join(home, ".claude.json"),
    claudeDesktopCodeRoot: undefined,
    bobExecutable: undefined,
    bobApp: applications && path.join(applications, "IBM Bob.app"),
    bobMcp: path.join(home, ".bob", "settings", "mcp.json"),
    bobLegacyMcp: path.join(home, ".bob", "settings", "mcp_settings.json"),
    bobExtensionLegacyMcp: path.join(bobUserData, "User", "globalStorage", "ibm.bob-code", "settings", "mcp_settings.json"),
    vscodeExecutable: undefined,
    vscodeApp: applications && path.join(applications, "Visual Studio Code.app"),
    vscodeMcp: platform === "darwin" ? path.join(home, "Library", "Application Support", "Code", "User", "mcp.json") : path.join(config, "Code", "User", "mcp.json"),
    claudeDesktopApp: applications && path.join(applications, "Claude.app"),
    claudeDesktopConfig: platform === "darwin" ? path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json") : path.join(config, "Claude", "claude_desktop_config.json"),
    cursorApp: applications && path.join(applications, "Cursor.app"),
    cursorMcp: path.join(home, ".cursor", "mcp.json"),
    windsurfApp: applications && path.join(applications, "Windsurf.app"),
    windsurfMcp: path.join(home, ".codeium", "windsurf", "mcp_config.json"),
    kiroExecutable: undefined,
    kiroApp: applications && path.join(applications, "Kiro.app"),
    kiroHome: path.join(home, ".kiro"),
    kiroMcp: path.join(home, ".kiro", "settings", "mcp.json"),
    geminiHome: path.join(home, ".gemini"),
    geminiConfig: path.join(home, ".gemini", "settings.json"),
    zedApp: applications && path.join(applications, "Zed.app"),
    zedHome: platform === "darwin" ? path.join(home, "Library", "Application Support", "Zed") : path.join(config, "zed"),
    zedConfig: platform === "darwin" ? path.join(home, "Library", "Application Support", "Zed", "settings.json") : path.join(config, "zed", "settings.json"),
    openCodeHome: path.join(config, "opencode"),
    openCodeConfig: path.join(config, "opencode", "opencode.json")
  };
}

function describeRuntime(platform, env) {
  const wsl = platform === "linux" && Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
  return {
    kind: wsl ? "wsl" : platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux",
    label: wsl ? `WSL${env.WSL_DISTRO_NAME ? ` (${env.WSL_DISTRO_NAME})` : ""}` : platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : "Linux",
    isolated: wsl,
    note: wsl ? "Configures agents installed inside this WSL distribution, not Windows applications." : "Configures agents installed in this operating-system environment."
  };
}

function platformBinaryDir(platform) {
  if (platform === "win32") return "windows-x86_64";
  if (platform === "darwin") return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  return process.arch === "arm64" ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl";
}

function executableName(name, platform) {
  return platform === "win32" ? `${name}.exe` : name;
}

function compact(values) {
  return values.filter(Boolean);
}
