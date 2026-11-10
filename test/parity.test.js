import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loginFromCli, parseFlags } from "../src/cli-login.js";
import { ConnectionStore } from "../src/connection-store.js";
import { splitLines } from "../src/extra-tools.js";
import { createHttpApp } from "../src/http-server.js";
import { ebcdicToText, numberToPacked, numberToZoned, packedToNumber, textToEbcdic, zonedToNumber } from "../src/ibmi-data.js";
import { createMcpServer } from "../src/mcp-server.js";
import { deriveOctoKey, encryptOctoData, importOctoConnection, octoSessionFilePath, readOctoSession } from "../src/octo-session.js";
import { TOOL_GROUP_IDS, groupForTool, parseGroups } from "../src/tool-groups.js";
import { buildDependencyGraphView, buildKanbanView } from "../src/views.js";

function createHarness({ postHandler, getHandler, profile = "core", groups, connections, octo } = {}) {
  const calls = [];
  const saved = connections || [{ id: "conn-1", name: "DEMO", host: "example.test", port: "45011", library: "OMS", username: "tester", token: "token", password: "secret" }];
  const store = {
    tokens: {},
    async listConnections() {
      return saved.map(({ password, token, ...rest }) => rest);
    },
    async getConnection(id) {
      const found = saved.find((connection) => connection.id === id);
      return found ? { ...found, token: this.tokens[id] ?? found.token } : undefined;
    },
    async saveToken(id, token) {
      this.tokens[id] = token;
    },
    async updateStatus() {}
  };
  const clientFactory = () => ({
    async login() {
      return "token";
    },
    async get(service, endpoint, token) {
      calls.push({ service, path: endpoint, token, method: "GET" });
      return (getHandler && await getHandler({ service, path: endpoint, token })) ?? { applications: [] };
    },
    async post(service, endpoint, body, token) {
      calls.push({ service, path: endpoint, body, token, method: "POST" });
      return (postHandler && await postHandler({ service, path: endpoint, body, token, calls })) ?? {};
    }
  });
  const server = createMcpServer({ store, clientFactory, profile, groups, octo });
  const call = async (name, input = {}) => (await server._registeredTools[name].handler(input)).structuredContent;
  return { server, store, calls, call };
}

const tasks = [
  { applicationCode: "DEMOAPP", fixNumber: "T1001", shortFixDescription: "First", fixStatus: "Open", programmer: "TESTER" },
  { applicationCode: "DEMOAPP", fixNumber: "T1002", shortFixDescription: "Second", fixStatus: "Open", programmer: "TESTER" },
  { applicationCode: "DEMOAPP", fixNumber: "T1003", shortFixDescription: "Third", fixStatus: "Completed", programmer: "TESTER" }
];

test("every tool belongs to a group and profiles load only the requested groups", () => {
  const full = Object.keys(createHarness({ profile: "full" }).server._registeredTools);
  assert.deepEqual(full.filter((name) => !groupForTool(name)), []);
  assert.ok(full.every((name) => TOOL_GROUP_IDS.includes(groupForTool(name))));

  const scoped = Object.keys(createHarness({ groups: "source" }).server._registeredTools);
  assert.ok(scoped.includes("tdoms_check_source"));
  assert.ok(scoped.includes("tdoms_get_current_context"));
  assert.ok(!scoped.includes("tdoms_task_search"));
  assert.ok(scoped.length < 40);

  assert.deepEqual(parseGroups("all"), TOOL_GROUP_IDS);
  assert.throws(() => parseGroups("nope"), /Unknown TD\/OMS MCP tool group/);
});

test("the catalog lists groups, describes tools, and runs tools that are not loaded", async () => {
  const { call, calls, server } = createHarness();
  assert.equal(server._registeredTools.tdoms_data_area_create, undefined);

  const groups = await call("tdoms_list_tool_groups");
  assert.deepEqual(groups.groups.map((group) => group.id), TOOL_GROUP_IDS);
  assert.deepEqual(groups.groups.filter((group) => group.loaded).map((group) => group.id), ["core"]);
  assert.equal(groups.groups.find((group) => group.id === "core").toolCount, 12);

  const listed = await call("tdoms_describe_tools", { group: "requests" });
  assert.equal(listed.count, 13);
  assert.equal(listed.tools[0].inputSchema, undefined);

  const described = await call("tdoms_describe_tools", { tools: ["tdoms_data_area_create"] });
  assert.equal(described.tools[0].group, "objects");
  assert.ok(described.tools[0].inputSchema.properties.dataArea);
  assert.ok(!described.tools[0].inputSchema.required.includes("connectionId"));

  await assert.rejects(call("tdoms_run_tool", { tool: "tdoms_data_area_create", arguments: { dataArea: 5 } }), /Invalid arguments/);
  await assert.rejects(call("tdoms_run_tool", { tool: "tdoms_missing", arguments: {} }), /Unknown tool/);

  const created = await call("tdoms_run_tool", {
    tool: "tdoms_data_area_create",
    arguments: { applicationCode: "DEMOAPP", taskNumber: "T1001", environment: "DEV", dataArea: "DEMODTA", library: "DEMOLIB", type: "*CHAR", length: 10, confirm: true }
  });
  assert.equal(created.ok, true);
  assert.equal(calls.at(-1).service + calls.at(-1).path, "OMQRNO/addDataArea");
  assert.deepEqual(calls.at(-1).body, { applicationCode: "DEMOAPP", taskNumber: "T1001", environment: "DEV", dataArea: "DEMODTA", library: "DEMOLIB", type: "*CHAR", length: 10 });
});

test("working context supplies the connection, application and task when omitted", async () => {
  const { call, calls } = createHarness({
    connections: [
      { id: "conn-1", name: "ONE", host: "one.test", port: "1", library: "OMS", username: "tester", token: "t1" },
      { id: "conn-2", name: "TWO", host: "two.test", port: "1", library: "OMS", username: "tester", token: "t2" }
    ]
  });
  await assert.rejects(call("tdoms_get_current_context"), /Multiple TD\/OMS connections/);
  await assert.rejects(call("tdoms_set_working_context", { activeConnectionId: "nope" }), /Connection not found/);

  const saved = await call("tdoms_set_working_context", { activeConnectionId: "conn-2", applicationCode: "DEMOAPP", taskNumber: "T1001" });
  assert.deepEqual(saved.workingContext, { activeConnectionId: "conn-2", applicationCode: "DEMOAPP", taskNumber: "T1001" });

  const context = await call("tdoms_get_current_context");
  assert.equal(context.connection.id, "conn-2");
  assert.equal(context.defaults.taskNumber, "T1001");

  const created = await call("tdoms_run_tool", {
    tool: "tdoms_data_area_create",
    arguments: { environment: "DEV", dataArea: "DEMODTA", library: "DEMOLIB", type: "*CHAR", confirm: true }
  });
  assert.deepEqual(created.defaultsApplied, { applicationCode: "DEMOAPP", taskNumber: "T1001" });
  assert.equal(calls.at(-1).token, "t2");
  assert.equal(calls.at(-1).body.taskNumber, "T1001");

  const cleared = await call("tdoms_set_working_context", { taskNumber: null });
  assert.equal(cleared.workingContext.taskNumber, undefined);
  await assert.rejects(
    call("tdoms_run_tool", { tool: "tdoms_data_area_create", arguments: { environment: "DEV", dataArea: "D", library: "L", type: "*CHAR", confirm: true } }),
    /needs taskNumber/
  );
});

test("kanban view groups the programmer's tasks by status with a summary", async () => {
  const { call, calls } = createHarness({
    postHandler: ({ service }) => service === "OMRDBA" ? { records: tasks, totalNumberOfRecords: 3 } : undefined
  });
  const view = await call("tdoms_get_view", { view: "kanban", applicationCode: "DEMOAPP" });
  assert.equal(view.widget.type, "board");
  assert.deepEqual(view.widget.columns.map((column) => [column.title, column.count]), [["Open", 2], ["Completed", 1]]);
  assert.equal(view.widget.columns[0].cards[0].title, "T1001");
  assert.equal(view.widget.columns[0].cards[0].actions[0].tool, "tdoms_task_details");
  assert.equal(view.summary, "3 tasks in 2 status columns: Open 2, Completed 1.");
  assert.deepEqual(calls[0].body.listInput.fieldSelections, [
    { field: "applicationCode", value: "DEMOAPP", operator: "EQ" },
    { field: "programmer", value: "TESTER", operator: "EQ" }
  ]);

  const analytics = await call("tdoms_get_view", { view: "analytics", allUsers: true });
  assert.equal(analytics.widget.breakdowns[0].items[0].label, "Open");
  assert.deepEqual(calls.at(-1).body.listInput.fieldSelections, []);

  const blocked = await call("tdoms_get_view", { view: "dependencyGraph", objectCode: "DEMOPGM" });
  assert.equal(blocked.ok, false);
});

test("view builders are usable without a server", () => {
  assert.equal(buildKanbanView([]).summary, "No tasks match, so the board is empty.");
  const graph = buildDependencyGraphView(
    { reportResult: { usedBy: [{ objectCode: "CALLER", objectType: "*PGM", objectLibrary: "DEMOLIB" }], uses: [{ objectCode: "DEMOFILE", objectType: "*FILE", objectLibrary: "DEMOLIB" }] } },
    { context: { objectCode: "DEMOPGM", objectType: "*PGM", objectLibrary: "DEMOLIB", memberCode: "DEMOPGM" } }
  );
  assert.equal(graph.widget.nodes.length, 3);
  assert.deepEqual(graph.widget.edges.map((edge) => edge.relation), ["usedBy", "uses"]);
  assert.match(graph.summary, /linked to 2 objects/);
});

test("checked source save refuses stale or read-only targets and reports the failed page", async () => {
  const target = { applicationCode: "DEMOAPP", taskNumber: "T1001", objectCode: "QRPGLESRC", objectType: "*FILE", objectLibrary: "DEMOLIB", memberCode: "DEMOSRC" };
  let metadata = { canEdit: true, ccsid: 37, lastChangeDate: "2026-01-02", numberOfPages: 1 };
  let failOnPage;
  const { call, calls } = createHarness({
    postHandler: ({ path: endpoint, body }) => {
      if (endpoint === "/object/get") return metadata;
      if (endpoint === "/object/save" && body.pageNumber === failOnPage) throw new Error("TD/OMS POST failed with 500");
      return { status: "*NORM" };
    }
  });
  const run = (name, args) => call("tdoms_run_tool", { tool: name, arguments: args });

  const checked = await run("tdoms_check_source", target);
  assert.equal(checked.metadata.lastChangeDate, "2026-01-02");
  assert.equal(calls.at(-1).body.pageNumber, 0);

  const stale = await run("tdoms_save_source_checked", { ...target, sourceText: "a\n", expectedLastChangeDate: "2026-01-01", confirm: true });
  assert.equal(stale.saved, false);
  assert.match(stale.reason, /changed after it was last read/);
  assert.ok(!calls.some((entry) => entry.path === "/object/save"));

  const forced = await run("tdoms_save_source_checked", { ...target, sourceText: "a\n", expectedLastChangeDate: "2026-01-01", forceSave: true, confirm: true });
  assert.equal(forced.saved, true);
  assert.equal(calls.find((entry) => entry.path === "/object/save").body.forceSave, true);

  const longText = Array.from({ length: 9000 }, (_, index) => `line ${index}\r\n`).join("");
  failOnPage = 2;
  const failed = await run("tdoms_save_source_checked", { ...target, sourceText: longText, expectedLastChangeDate: "2026-01-02", confirm: true });
  assert.deepEqual([failed.saved, failed.failedPage, failed.acknowledgedPages, failed.numberOfPages], [false, 2, 1, 3]);

  metadata = { ...metadata, canEdit: false };
  const readOnly = await run("tdoms_save_source_checked", { ...target, sourceText: "a", confirm: true });
  assert.match(readOnly.reason, /not editable/);

  await assert.rejects(run("tdoms_save_source_checked", { ...target, sourceText: "a" }), /confirm: true/);
  await assert.rejects(run("tdoms_check_source", { ...target, path: "/home/demo.txt" }), /not both/);
  assert.equal(splitLines(longText, 4000).join(""), longText);
  assert.equal(splitLines("", 4000).length, 1);
});

test("object template tools build the documented OMQROT bodies", async () => {
  const { call, calls } = createHarness();
  const run = (name, args) => call("tdoms_run_tool", { tool: name, arguments: args });
  await run("tdoms_object_template_copy", { category: "RPG", description: "Program", newDescription: "Program copy", objectType: "*PGM", confirm: true });
  assert.equal(calls.at(-1).service + calls.at(-1).path, "OMQROT/copy");
  assert.deepEqual(calls.at(-1).body, {
    interfaceLevel: "V3R0M0",
    copyProcessingOptions: { updateDb: "1", updateBuffer: "1" },
    copyTemplateData: { category: "RPG", description: "Program", newDescription: "Program copy", objectType: "*PGM" }
  });
  await run("tdoms_object_template_delete", { category: "RPG", description: "Program copy", confirm: true });
  assert.deepEqual(Object.keys(calls.at(-1).body), ["interfaceLevel", "deleteProcessingOptions", "deleteTemplateData"]);
  await assert.rejects(run("tdoms_object_template_add", { category: "RPG", description: "X" }), /confirm: true/);
});

test("Octo session can be read and imported, and its token is refreshed after sign-in", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "tdoms-octo-"));
  const identity = { username: "demo", hostname: "demo-host" };
  const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
  const writeSession = async (config) => {
    const file = octoSessionFilePath(home);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, encryptOctoData(JSON.stringify(config), deriveOctoKey(identity)));
  };
  const read = (extra) => readOctoSession({ homedir: home, ...identity, ...extra });

  assert.equal((await read()).found, false);
  const future = Math.floor(Date.now() / 1000) + 3600;
  await writeSession({ basePath: "https://tdoms.example.test:45011/OMS", accessToken: jwt({ sub: "DEVUSER", email: "dev@example.test", exp: future }) });
  assert.equal((await read({ hostname: "other-host" })).found, false);

  const session = await read();
  assert.deepEqual([session.host, session.port, session.library, session.username, session.email, session.tokenExpired], ["tdoms.example.test", "45011", "OMS", "DEVUSER", "dev@example.test", false]);

  const store = new ConnectionStore(path.join(home, "data"), { env: {} });
  const imported = await importOctoConnection(store, { session });
  assert.deepEqual([imported.created, imported.tokenReused, imported.connection.source, imported.connection.username], [true, true, "octo", "DEVUSER"]);
  assert.equal((await importOctoConnection(store, { session })).created, false);
  assert.equal((await store.listConnections()).length, 1);
  assert.equal(JSON.stringify(await store.listConnections()).includes(session.accessToken), false);

  // The saved token is rejected once; the server picks up the token Octo wrote after a new sign-in.
  const renewed = jwt({ sub: "DEVUSER", exp: future + 60 });
  await writeSession({ basePath: "https://tdoms.example.test:45011/OMS", accessToken: renewed });
  const seen = [];
  const server = createMcpServer({
    store,
    octo: { readSession: read },
    clientFactory: () => ({
      async login() {
        throw new Error("login must not be called without a password");
      },
      async get(_service, _path, token) {
        seen.push(token);
        if (token !== renewed) throw new Error("TD/OMS GET failed with 401: unauthorized");
        return { applications: [] };
      }
    })
  });
  const context = (await server._registeredTools.tdoms_get_current_context.handler({})).structuredContent;
  assert.equal(context.user.email, "dev@example.test");
  assert.deepEqual(seen, [session.accessToken, renewed]);

  const status = (await server._registeredTools.tdoms_run_tool.handler({ tool: "tdoms_connection_octo_status", arguments: {} })).structuredContent;
  assert.equal(status.hasToken, true);
  assert.equal(status.accessToken, undefined);
  await fs.rm(home, { recursive: true, force: true });
});

test("CLI login saves a connection only after a successful sign-in", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tdoms-login-"));
  const store = new ConnectionStore(dir, { env: {} });
  const flags = parseFlags(["--host", "tdoms.example.test", "--port=45011", "--username", "DEVUSER", "--no-active"]);
  assert.deepEqual(flags, { host: "tdoms.example.test", port: "45011", username: "DEVUSER", "no-active": true });

  const failing = () => ({ async login() { throw new Error("bad password"); } });
  await assert.rejects(loginFromCli({ store, flags, env: { TDOMS_MCP_PASSWORD: "x" }, clientFactory: failing }), /bad password/);
  assert.equal((await store.listConnections()).length, 0);

  const working = () => ({ async login() { return "jwt"; }, async getSystemInfo() { return { applications: [{ applicationCode: "DEMOAPP" }] }; } });
  const done = await loginFromCli({ store, flags: { ...flags, "no-active": undefined }, env: { TDOMS_MCP_PASSWORD: "x" }, clientFactory: working });
  assert.equal(done.applicationCount, 1);
  assert.equal((await store.getWorkingContext()).activeConnectionId, done.connection.id);
  assert.equal((await store.getConnection(done.connection.id, { includeSecrets: true })).token, "jwt");
  await assert.rejects(loginFromCli({ store, flags: { host: "x" }, env: {} }), /Missing --port, --username/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("HTTP transport requires the bearer token and serves MCP sessions", async () => {
  const { store } = createHarness();
  const app = createHttpApp({ store, token: "secret-token", serverFactory: (options) => createMcpServer({ ...options, clientFactory: () => ({}) }) });
  const listener = await new Promise((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  const url = `http://127.0.0.1:${listener.address().port}/mcp`;
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
  try {
    assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify(initialize) })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { ...headers, authorization: "Bearer wrong-token!" }, body: JSON.stringify(initialize) })).status, 401);
    const authorized = { ...headers, authorization: "Bearer secret-token" };
    assert.equal((await fetch(url, { method: "POST", headers: authorized, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) })).status, 400);
    const foreignHost = await new Promise((resolve, reject) => {
      const request = http.request(url, { method: "POST", headers: { ...authorized, host: "evil.example" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on("error", reject);
      request.end(JSON.stringify(initialize));
    });
    assert.equal(foreignHost, 403);

    const started = await fetch(url, { method: "POST", headers: authorized, body: JSON.stringify(initialize) });
    assert.equal(started.status, 200);
    const sessionId = started.headers.get("mcp-session-id");
    assert.ok(sessionId);
    await started.text();
    const listed = await fetch(url, { method: "POST", headers: { ...authorized, "mcp-session-id": sessionId }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
    assert.match(await listed.text(), /tdoms_list_tool_groups/);
  } finally {
    listener.closeAllConnections();
    await new Promise((resolve) => listener.close(resolve));
  }
});

test("IBM i conversions round-trip", () => {
  assert.equal(ebcdicToText("C8C5D3D3D640F1"), "HELLO 1");
  assert.equal(textToEbcdic("HELLO 1"), "C8C5D3D3D640F1");
  assert.equal(numberToPacked("-123.45", 7, 2), "0012345D");
  assert.equal(packedToNumber("0012345D", 2), "-123.45");
  assert.equal(packedToNumber("12345F", 0), "12345");
  assert.equal(numberToZoned("-12", 5, 0), "F0F0F0F1D2");
  assert.equal(zonedToNumber("F0F0F0F1D2", 0), "-12");
  assert.throws(() => numberToPacked("1234", 3, 0), /does not fit/);
  assert.throws(() => numberToPacked("1.239", 5, 2), /more than 2 decimal places/);
  assert.throws(() => packedToNumber("12G"), /hexadecimal/);
  assert.throws(() => textToEbcdic("€"), /no CCSID 37 mapping/);
});
