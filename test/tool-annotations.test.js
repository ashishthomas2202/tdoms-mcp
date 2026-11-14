import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp-server.js";
import { TOOL_ANNOTATIONS } from "../src/tool-annotations.js";

// Name parts that mean a tool changes TD/OMS or local state.
const CHANGE_WORDS = new Set([
  "add", "apply", "authorize", "cancel", "change", "checkout", "clear", "close", "complete", "connect", "copy", "create",
  "delete", "disconnect", "execute", "hold", "import", "link", "lock", "login", "move", "patch", "process", "promote",
  "purge", "queue", "ratify", "refill", "release", "remove", "rename", "reopen", "reply", "restore", "save", "schedule",
  "set", "stash", "status", "test", "unlink", "unlock", "compile", "token"
]);

// Read-only tools whose names contain one of those words, and why they only read.
const READ_ONLY_EXCEPTIONS = {
  tdoms_dashboard_execute: "runs a stored dashboard query",
  tdoms_get_workflow_status: "reads the state of a planned workflow",
  tdoms_connection_octo_status: "checks for a local Octo sign-in",
  tdoms_task_compile_results: "lists compile results",
  tdoms_solution_compile_results: "lists compile results",
  tdoms_solution_compile_overrides: "lists compile overrides",
  tdoms_compile_results: "lists compile results",
  tdoms_compile_errors: "lists compile diagnostics",
  tdoms_compile_event_raw_records: "fetches compile event records",
  tdoms_compile_event_parse: "parses compile event records",
  tdoms_parse_compile_events: "parses compile event records",
  tdoms_build_queue_list: "lists the build queue",
  tdoms_build_queue_for_task: "lists the build queue",
  tdoms_build_queue_for_solution: "lists the build queue",
  tdoms_build_queue_for_object: "lists the build queue",
  tdoms_task_build_queue: "lists the build queue",
  tdoms_solution_build_queue: "lists the build queue"
};

// Name parts that always mean removal or an irreversible step.
const DESTRUCTIVE_WORDS = new Set(["delete", "purge", "unlink", "disconnect", "cancel", "complete", "ratify", "promote", "remove"]);

function fullServer(post = async () => ({ returnStatus: { status: "*NORM" }, records: [] })) {
  const calls = [];
  const store = {
    async listConnections() { return [{ id: "conn-1", name: "DEMO" }]; },
    async getConnection(id) {
      return id === "conn-1" ? { id, name: "DEMO", protocol: "https", host: "example.test", port: "1", library: "OMS", username: "tester", password: "secret", token: "token" } : undefined;
    },
    async saveToken() {},
    async updateStatus() {}
  };
  const clientFactory = () => ({
    async login() { return "token"; },
    async post(service, path, body) {
      calls.push({ service, path, body });
      return post(service, path, body);
    }
  });
  return { calls, server: createMcpServer({ store, clientFactory, profile: "full" }) };
}

async function listTools(server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "annotations-test", version: "0.0.0" });
  await client.connect(clientTransport);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

test("every registered tool carries MCP annotations over the protocol", async () => {
  const { server } = fullServer();
  const tools = await listTools(server);
  assert.ok(tools.length > 200);
  const missing = tools.filter((tool) => typeof tool.annotations?.readOnlyHint !== "boolean").map((tool) => tool.name);
  assert.deepEqual(missing, []);
  for (const tool of tools) {
    if (tool.annotations.readOnlyHint) {
      assert.equal(tool.annotations.openWorldHint, false, tool.name);
    } else {
      assert.equal(typeof tool.annotations.destructiveHint, "boolean", tool.name);
    }
  }
  const registered = new Set(tools.map((tool) => tool.name));
  const stale = [...TOOL_ANNOTATIONS.keys()].filter((name) => !registered.has(name));
  assert.deepEqual(stale, [], "annotation entries for tools that are not registered");
});

test("no tool that changes something is marked read-only", () => {
  const offenders = [];
  for (const [name, annotations] of TOOL_ANNOTATIONS) {
    const words = name.replace(/^tdoms_/, "").split("_");
    if (annotations.readOnlyHint && words.some((word) => CHANGE_WORDS.has(word)) && !READ_ONLY_EXCEPTIONS[name]) {
      offenders.push(name);
    }
    if (words.some((word) => DESTRUCTIVE_WORDS.has(word)) && annotations.destructiveHint !== true) {
      offenders.push(`${name} (should be destructive)`);
    }
  }
  assert.deepEqual(offenders, []);
  assert.equal(TOOL_ANNOTATIONS.get("tdoms_plan_workflow").readOnlyHint, true);
  assert.equal(TOOL_ANNOTATIONS.get("tdoms_execute_workflow").destructiveHint, true);
  assert.equal(TOOL_ANNOTATIONS.get("tdoms_run_tool").destructiveHint, true);
  assert.equal(TOOL_ANNOTATIONS.get("tdoms_call_api").destructiveHint, true);
  assert.equal(TOOL_ANNOTATIONS.get("tdoms_run_read_tool").readOnlyHint, true);
});

test("tdoms_run_read_tool runs read tools and refuses tools that change TD/OMS", async () => {
  const { calls, server } = fullServer(async () => ({ returnStatus: { status: "*NORM" }, records: [{ fixNumber: "T0042" }] }));
  const run = server._registeredTools.tdoms_run_read_tool.handler;

  const read = await run({ tool: "tdoms_task_search", arguments: { connectionId: "conn-1", applicationCode: "DEMO" } });
  assert.equal(read.structuredContent.response.records[0].fixNumber, "T0042");
  assert.equal(calls.length, 1);

  await assert.rejects(
    () => run({ tool: "tdoms_task_delete", arguments: { connectionId: "conn-1", body: {}, confirm: true } }),
    /not a read-only tool/
  );
  await assert.rejects(() => run({ tool: "tdoms_run_tool", arguments: {} }), /Unknown tool|not a read-only tool/);
  assert.equal(calls.length, 1);
});
