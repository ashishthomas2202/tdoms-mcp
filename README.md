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

The `core` profile keeps the tool list small and reaches every other tool through the catalog; see [Tool Groups](#tool-groups).

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

The package includes a portable developer skill at `skills/tdoms-mcp-routing`. Its `SKILL.md` teaches agents how to find tools by group; discover site-specific values; perform guarded task, source, compile, checkout, promote, transfer, branch, and approval workflows; and verify final TD/OMS state.

The CLI and local UI can install the complete skill folder for detected IBM Bob, Codex, Claude Code, VS Code Copilot, Kiro, and Gemini CLI installations. The skill contains no credentials, connection profiles, organization-specific values, or personal information. Runtime tool schemas and values returned by the connected TD/OMS server remain authoritative.

List the native skill targets and their installation status:

```shell
tdoms-mcp skills
```

Install or update the skill for one agent. User scope makes it available across that agent's projects; workspace scope installs it only in the current project:

```shell
tdoms-mcp install-skill ibm-bob --scope user --confirm
tdoms-mcp install-skill codex --scope user --confirm
tdoms-mcp install-skill claude-code --scope workspace --confirm
tdoms-mcp install-skill vscode --scope workspace --confirm
tdoms-mcp install-skill kiro --scope user --confirm
tdoms-mcp install-skill gemini-cli --scope user --confirm
```

Install or update the skill for every detected compatible agent:

```shell
tdoms-mcp install-detected-skills --scope user --confirm
```

The Agent Setup page in `tdoms-mcp ui` provides the same actions with User skill and Workspace skill scope controls. Existing skill folders are timestamped and backed up before replacement, concurrent installs are locked, and a failed replacement restores the prior folder. Bob users must enable Advanced mode; existing agent sessions may need to be restarted or reloaded after installation. Claude Desktop chat requires a ZIP upload to **Customize > Skills**; its row provides a correctly packaged download instead of reporting a local folder copy as installed.

The **Codex** row covers the Codex desktop app, CLI, and VS Code extension through `~/.agents/skills`. Restart Codex or reload the VS Code window and start a new task if a newly installed skill is not visible. The **Visual Studio Code** skill action installs for every compatible extension it detects: Codex through `~/.agents/skills`, Claude Code through `~/.claude/skills`, and GitHub Copilot through `~/.copilot/skills`. Use `/skills` in agents that expose that menu, or invoke the skill by name in Codex and Claude Code.

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

MCP and skill installation are separate on purpose: the MCP provides live TD/OMS tools, while the skill teaches an agent how to route requests and perform guarded change-management workflows. Install both for the complete experience.

## Tool Groups

Tools are grouped so an agent loads a small list and still reaches everything. The default `core` profile loads 12 tools:

- `tdoms_list_connections`, `tdoms_get_current_context`, `tdoms_set_working_context`
- `tdoms_list_capabilities`, `tdoms_discover_options`
- `tdoms_plan_workflow`, `tdoms_execute_workflow`, `tdoms_get_workflow_status`
- `tdoms_get_view`
- `tdoms_list_tool_groups`, `tdoms_describe_tools`, `tdoms_run_tool`

Every other tool belongs to one of these groups:

| Group | Covers |
| --- | --- |
| `connection` | Saved connections, login, token refresh, Octo sign-in import, system and license info, user context |
| `tasks` | Tasks, task comments and labels |
| `requests` | Requests |
| `objects` | Objects, solutions, components, connection lists, new objects, data areas, IFS objects, object templates |
| `source` | Source and IFS check, read, save, patch and compare |
| `build` | Build queue, compile results and errors, compile overrides, spooled files |
| `transfer` | Checkout, promote, transfer, branches, version conflicts, managed deployments, remote jobs |
| `insight` | Logs, dashboards, impact and dependency analysis, Kanban data, tracker records |
| `admin` | Data dictionary, saved searches, user options, database queries, raw REST access, IBM i data conversions |

An agent calls `tdoms_list_tool_groups`, reads one group with `tdoms_describe_tools`, and calls any tool with `tdoms_run_tool`. Schemas are fetched only for the tools about to be used.

To load groups as directly callable tools, name them at startup:

```shell
tdoms-mcp mcp --groups tasks,source
```

The equivalent environment setting is `TDOMS_MCP_GROUPS=tasks,source`. `tdoms-mcp mcp --profile full` (or `TDOMS_MCP_PROFILE=full`) loads every group; use it only for clients without a tool budget. `tdoms_call_api` in the `admin` group remains an escape hatch for documented endpoints. All tools that can change TD/OMS require explicit confirmation.

## Working Context And Defaults

Call `tdoms_get_current_context` first. When one connection exists it is selected automatically, and the saved TD/OMS username becomes the default programmer ID.

`tdoms_set_working_context` saves the active connection, application, task, request, environment and transfer path. After that, calls may omit `connectionId`, and tools that require an application or task fall back to the saved values and report them as `defaultsApplied`. The context is stored in the local data directory and shared by every agent on the machine.

## Signing In

Credentials never pass through agent chat. Use one of:

- `tdoms-mcp ui`: the local control plane page. Add a connection, sign in to IBM i, pick the active connection, sign in to Octo, set up agents and browse the tool groups. It only answers requests addressed to this machine.
- `tdoms-mcp login --host <host> --port <port> --username <user>`: prompts for the password in the terminal, or reads `TDOMS_MCP_PASSWORD` for unattended setup. Nothing is saved unless the sign-in succeeds.
- `tdoms-mcp import-octo --confirm`, or the `tdoms_connection_import_octo` tool: reuses the TD/OMS server and session of the Octo extension when it is signed in on the same machine. Run it without `--confirm` to preview. When the imported token expires, sign in to Octo again and the next call picks up the new token, or save a password with `tdoms-mcp login`.

### Octo Account (Optional)

TD/OMS tools only need the IBM i connection. Signing in to an Octo server as well is optional and gives access to what that server publishes for your organization, such as its MCP tool definitions and agent skills.

- In `tdoms-mcp ui`, open **Octo sign-in** and enter the organization URL (the address you open Octo with, for example `https://octo.example.com/org/acme`), your username or email and your password. A two-factor code is asked for when the account needs one.
- From a terminal: `tdoms-mcp octo-login --url <organization url> --username <user or email>`. The password comes from a hidden prompt or `TDOMS_MCP_OCTO_PASSWORD`.
- `tdoms-mcp octo-probe` runs a read-only check of what the account can see and prints counts and names only, with no secrets.
- `tdoms-mcp octo-status` shows the saved account and `tdoms-mcp octo-logout` removes it.

The password is used once and never stored. Only the API key the server returns is kept, encrypted in the local data directory.

## Discovery And Planned Changes

Use `tdoms_discover_options` for both site-specific choices and structured reads. It supports workflow choices such as environments, programmers, paths, transfer targets, templates, reasons, conflicts, and user options. It also replaces extension views with task, request, component, source, queue, compile, history, log, spool, tracker, dependency, and dashboard reads. Task reads default to the current programmer; pass `context.allUsers: true` only when a broader search is intended.

For a mutation:

1. Discover the valid choices.
2. Call `tdoms_plan_workflow` with the chosen context, exact request body, and `optionSelections` keyed by option-set name. Those choices are validated now and before execution.
3. Review its endpoint/body preview and obtain user approval.
4. Call `tdoms_execute_workflow` with the returned `planId` and `confirm: true`.
5. Call `tdoms_get_workflow_status` when the operation is asynchronous.

Plans expire after ten minutes. Execution re-reads relevant TD/OMS state and rejects stale plans. A plan can execute only once.

## Views For Apps And Agents

`tdoms_get_view` returns Work Management, Kanban, analytics, dependency graph, build queue and transfer history as UI-neutral data. Each response has a `widget` (`board`, `table`, `stats` or `graph`) that an app renders its own way, and a plain-language `summary` an agent can relay. Cards and rows carry suggested follow-up tool calls. The shapes are documented in [docs/view-models.md](docs/view-models.md).

## Embedding In An App

The package exports its building blocks, so a desktop app can host the server in-process on any MCP transport:

```js
import { createMcpServer, ConnectionStore } from "tdoms-mcp";

const server = createMcpServer({ store: new ConnectionStore(), groups: "tasks,source" });
await server.connect(transport);
```

Apps and agents that cannot launch a local process can use Streamable HTTP:

```shell
tdoms-mcp http --port 3738
```

The endpoint is `http://127.0.0.1:3738/mcp`. Every request needs `Authorization: Bearer <token>`; the token comes from `TDOMS_MCP_HTTP_TOKEN` or is generated once into the data directory as `http-token`. The listener refuses non-loopback hosts unless `TDOMS_MCP_HTTP_ALLOW_REMOTE=1` is set, because it serves plain HTTP; put a TLS proxy in front before exposing it.

## CLI Reference

```text
tdoms-mcp ui                              Open the local connection and agent setup UI
tdoms-mcp clients                         List detected MCP-capable agents
tdoms-mcp skills                          List native skill targets and status
tdoms-mcp install-client <id> --confirm   Configure one detected agent
tdoms-mcp install-detected --confirm      Configure all detected agents
tdoms-mcp install-skill <id> --scope user --confirm
                                          Install a skill for one detected agent
tdoms-mcp install-detected-skills --scope user --confirm
                                          Install skills for all compatible agents
tdoms-mcp mcp                             Start the core stdio MCP server
tdoms-mcp mcp --groups tasks,source       Start core plus the named tool groups
tdoms-mcp mcp --profile full              Start with every tool group loaded
tdoms-mcp http [--port 3738]              Start the Streamable HTTP MCP server
tdoms-mcp groups                          List the tool groups
tdoms-mcp login --host ... --username ... Save a connection and sign in from the terminal
tdoms-mcp import-octo --confirm           Reuse the Octo extension's signed-in session
tdoms-mcp octo-login --url ... --username ...
                                          Sign in to an Octo server (optional)
tdoms-mcp octo-probe                      Read-only check of what the Octo account can see
tdoms-mcp octo-status                     Show the saved Octo account
tdoms-mcp octo-logout                     Remove the saved Octo account
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
