# TD/OMS MCP

Standalone TD/OMS change-management MCP for IBM Bob, Codex, Claude-compatible clients, and other agents that can launch a local stdio MCP server. It talks directly to TD/OMS REST APIs and does not require or control the Octo VS Code extension.

This is an independent community project. It is not affiliated with, maintained by, or endorsed by Remain Software, IBM, or their affiliates. TD/OMS, Octo, IBM, IBM i, and IBM Bob are trademarks of their respective owners.

## Install

TD/OMS MCP is a command-line MCP server, not an application dependency. Install it globally so local agents can launch the `tdoms-mcp` command:

```shell
npm install --global tdoms-mcp
tdoms-mcp ui
```

To try it without installing it globally:

```shell
npx --yes tdoms-mcp@latest ui
```

Open `http://127.0.0.1:3737`, add a TD/OMS connection, and test it. Credentials and tokens stay in the local TD/OMS MCP data directory and are never returned to agents.

The Agent setup view detects supported MCP clients and can install or update this server after confirmation. Known configuration files are backed up before each change and restored automatically when a client command fails.

Keep TLS verification enabled. Publicly trusted certificates work without configuration. For an internal certificate authority, set the optional CA certificate file in the connection manager or set `TDOMS_MCP_CA_FILE` to an approved PEM file supplied by the organization.

After a global installation, start the compact agent-neutral profile:

```shell
tdoms-mcp mcp
```

Start the complete named-tool profile:

```shell
tdoms-mcp mcp --profile full
```

The equivalent environment setting is `TDOMS_MCP_PROFILE=core` or `TDOMS_MCP_PROFILE=full`. `core` is the default.

## Agent Configuration

Use the same local stdio definition in Bob and JSON-based MCP clients after a global npm installation:

```json
{
  "command": "tdoms-mcp",
  "args": ["mcp"],
  "env": {
    "TDOMS_MCP_PROFILE": "core"
  }
}
```

Codex TOML:

```toml
[mcp_servers.tdoms]
command = "tdoms-mcp"
args = ["mcp"]
env = { TDOMS_MCP_PROFILE = "core" }
startup_timeout_sec = 20
tool_timeout_sec = 60
```

Restart or reload the agent's MCP servers after changing the configuration.

## Agent Skill

The package includes a portable developer skill at `skills/tdoms-mcp-routing`. Its `SKILL.md` teaches agents how to select core, full-profile, or Octo tools; discover site-specific values; perform guarded task, source, compile, checkout, promote, transfer, branch, and approval workflows; and verify final TD/OMS state.

Agents that support `SKILL.md` folders can register that directory using their normal skill installation mechanism. The skill contains no credentials, connection profiles, organization-specific values, or personal information. Runtime tool schemas and values returned by the connected TD/OMS server remain authoritative.

Detect supported local clients from the installed command:

```shell
tdoms-mcp clients
```

Install or update one detected client:

```shell
tdoms-mcp install-client ibm-bob --confirm
tdoms-mcp install-client codex --confirm
tdoms-mcp install-client claude-code --confirm
tdoms-mcp install-client vscode --confirm
```

Configure every detected client that is not already configured:

```shell
tdoms-mcp install-detected --confirm
```

Documented adapters are included for IBM Bob, Codex, Claude Code sessions, Claude Desktop chat, VS Code, Cursor, Windsurf, Kiro, Gemini CLI, Zed, and OpenCode. Microsoft Store Claude installations use the app's virtualized configuration directory automatically.

IBM Bob uses its own global MCP store at `~/.bob/settings/mcp.json`; it does not use VS Code's user-level `mcp.json`. The installer preserves servers from Bob's older `~/.bob/settings/mcp_settings.json` file when creating the current configuration. Bob hot-reloads MCP changes when a workspace folder is open; manage the resulting servers from the MCP tab in the Bob panel settings menu.

Detection and installation are environment-local. Running the installer on Windows configures Windows agents; running it inside WSL configures only that WSL distribution; running it on macOS or Linux uses that platform's native paths. This prevents a Windows client from receiving an unusable WSL command, or the reverse. Claude has two targets: **Claude Code sessions** configures Code sessions opened from Claude Desktop or VS Code, while **Claude Desktop chat** configures regular Desktop chats.

Client installation never copies TD/OMS passwords or tokens into agent configuration. It registers only the local stdio command and the `core` tool profile. Existing files are backed up, writes are atomic, invalid JSON is rejected, and failed client updates are restored.

## Core Workflow

The default profile exposes seven tools:

- `tdoms_list_connections`
- `tdoms_get_current_context`
- `tdoms_list_capabilities`
- `tdoms_discover_options`
- `tdoms_plan_workflow`
- `tdoms_execute_workflow`
- `tdoms_get_workflow_status`

Call `tdoms_get_current_context` first. When one connection exists, it is selected automatically and the saved TD/OMS username becomes the default programmer ID. Octo sign-in context is not required.

Use `tdoms_discover_options` for both site-specific choices and structured reads. It supports workflow choices such as environments, programmers, paths, transfer targets, templates, reasons, conflicts, and user options. It also replaces extension views with task, request, component, source, queue, compile, history, log, spool, tracker, dependency, and dashboard reads. Task reads default to the current programmer; pass `context.allUsers: true` only when a broader search is intended.

For a mutation:

1. Discover the valid choices.
2. Call `tdoms_plan_workflow` with the chosen context, exact request body, and `optionSelections` keyed by option-set name. Those choices are validated now and before execution.
3. Review its endpoint/body preview and obtain user approval.
4. Call `tdoms_execute_workflow` with the returned `planId` and `confirm: true`.
5. Call `tdoms_get_workflow_status` when the operation is asynchronous.

Plans expire after ten minutes. Execution re-reads relevant TD/OMS state and rejects stale plans. A plan can execute only once.

## Full Profile

The `full` profile exposes 226 tools: the seven universal tools plus the existing task, request, solution, source, object, connection-list, compile, transfer, checkout, promote, branch, spool, log, remote-job, comment, label, user-option, analysis, dashboard, tracker, and administration tools.

All tools that can change TD/OMS require explicit confirmation. `tdoms_call_api` remains available in `full` as an advanced escape hatch for documented endpoints.

## CLI Reference

```text
tdoms-mcp ui                              Open the local connection and agent setup UI
tdoms-mcp clients                         List detected MCP-capable agents
tdoms-mcp install-client <id> --confirm   Configure one detected agent
tdoms-mcp install-detected --confirm      Configure all detected agents
tdoms-mcp mcp                             Start the core stdio MCP server
tdoms-mcp mcp --profile full              Start the complete tool profile
tdoms-mcp smoke                           Check local configuration without connecting
tdoms-mcp secure-storage                  Harden the local data directory
tdoms-mcp --help                          Show command help
```

## Development

The following commands are only for contributors working from a cloned source repository. They are not required after installing the npm package.

```shell
npm install
npm test
npm run smoke
npm run ui
```

Tests use mocked TD/OMS clients and do not mutate a real environment. Live mutation tests must be enabled deliberately against a dedicated test system.

Local profiles are stored under `%APPDATA%/tdoms-mcp` on Windows, `~/Library/Application Support/tdoms-mcp` on macOS, and `~/.config/tdoms-mcp` on Linux. Override this with `TDOMS_MCP_DATA_DIR`.

## Credential Storage

Connection metadata is stored in `connections.json`. Passwords and refreshed JWTs are encrypted with AES-256-GCM in `secrets.json`. By default, a random key is stored in `local.key`. All three files use atomic replacement and cross-process locking, and POSIX systems enforce `0700` on the directory and `0600` on files.

For stronger key separation, set `TDOMS_MCP_MASTER_KEY` to 32 random bytes encoded as base64 or 64 hexadecimal characters before adding connections. Keep the same value available to every MCP process that uses that data directory. Changing or losing it makes existing encrypted secrets unreadable.

Generate a base64 key:

```shell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

On Windows, restrict an existing data directory to the current user, SYSTEM, and local Administrators:

```powershell
tdoms-mcp secure-storage
```

Native WSL uses its own Linux data directory and requires Node.js 18 or newer. To reuse the Windows installation and Windows credentials from WSL, launch Windows `node.exe`; otherwise configure the connection separately inside WSL. Avoid sharing credential files through `/mnt/c` unless the Windows ACL has been hardened.

## License

Released under the MIT License. See `LICENSE`.
