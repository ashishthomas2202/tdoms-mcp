import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp-server.js";

function createHarness({ postHandler, getHandler, loginHandler, profile = "full", clock } = {}) {
  const calls = [];
  const store = {
    async listConnections() {
      return [{ id: "conn-1", name: "DEMO" }];
    },
    async getConnection(id) {
      if (id !== "conn-1") {
        return undefined;
      }
      return {
        id,
        name: "DEMO",
        protocol: "https",
        host: "example.test",
        port: "45011",
        library: "OMS",
        username: "tester",
        password: "secret",
        token: "token"
      };
    },
    async saveToken() {},
    async updateStatus() {}
  };
  const clientFactory = () => ({
    async login() {
      if (loginHandler) {
        return loginHandler();
      }
      return "token";
    },
    async getSystemInfo() {
      return { applications: [] };
    },
    async get(service, path, token) {
      calls.push({ service, path, body: undefined, token, method: "GET" });
      if (getHandler) {
        const handled = await getHandler({ service, path, token, method: "GET", calls });
        if (handled !== undefined) {
          return handled;
        }
      }
      return { service, path, token, method: "GET" };
    },
    async post(service, path, body, token) {
      calls.push({ service, path, body, token, method: "POST" });
      if (postHandler) {
        const handled = await postHandler({ service, path, body, token, method: "POST", calls });
        if (handled !== undefined) {
          return handled;
        }
      }
      return { service, path, body, token, method: "POST" };
    }
  });

  return {
    calls,
    server: createMcpServer({ store, clientFactory, profile, clock })
  };
}

async function callTool(server, name, input) {
  const tool = server._registeredTools[name];
  assert.ok(tool, `Tool not registered: ${name}`);
  return tool.handler(input);
}

test("registers broad TD/OMS workflow tools", () => {
  const { server } = createHarness();
  const tools = Object.keys(server._registeredTools).sort();

  for (const name of [
    "tdoms_call_api",
    "tdoms_read_source_all",
    "tdoms_save_source_all",
    "tdoms_patch_source_literal",
    "tdoms_task_action",
    "tdoms_request_action",
    "tdoms_transfer_action",
    "tdoms_solution_action",
    "tdoms_branch_action",
    "tdoms_spool_action",
    "tdoms_log_action",
    "tdoms_remote_job_action",
    "tdoms_object_action",
    "tdoms_compile_override_action",
    "tdoms_managed_deployment_action",
    "tdoms_fill_object_action",
    "tdoms_new_object_action",
    "tdoms_new_object_location",
    "tdoms_new_object_create",
    "tdoms_new_source_member_create",
    "tdoms_transfer_select_targets",
    "tdoms_transfer_prepare",
    "tdoms_transfer_execute_number",
    "tdoms_transfer_progress_number",
    "tdoms_compile_and_check"
  ]) {
    assert.ok(tools.includes(name), `${name} should be registered`);
  }
});

test("routes action tools to the documented TD/OMS service and path", async () => {
  const { server, calls } = createHarness();

  await callTool(server, "tdoms_task_action", {
    connectionId: "conn-1",
    action: "/status",
    body: { task: "T1001" },
    confirm: true
  });
  await callTool(server, "tdoms_request_action", {
    connectionId: "conn-1",
    action: "/connect",
    body: { request: "R1" },
    confirm: true
  });
  await callTool(server, "tdoms_transfer_action", {
    connectionId: "conn-1",
    action: "/execute",
    body: { transfer: "checkout" },
    confirm: true
  });
  await callTool(server, "tdoms_spool_action", {
    connectionId: "conn-1",
    action: "/list",
    body: { user: "tester" }
  });
  await callTool(server, "tdoms_log_action", {
    connectionId: "conn-1",
    action: "/getLogHistory",
    body: { task: "T1001" }
  });

  assert.deepEqual(
    calls.map(({ service, path }) => `${service}${path}`),
    ["OMQRTA/status", "OMQRRE/connect", "OMQRTO/execute", "OMQRSF/list", "OMQRLH/getLogHistory"]
  );
});

test("requires confirmation for mutating tools before making a TD/OMS call", async () => {
  const { server, calls } = createHarness();

  await assert.rejects(
    () => callTool(server, "tdoms_transfer_action", {
      connectionId: "conn-1",
      action: "/execute",
      body: { transfer: "checkout" }
    }),
    /confirm: true/
  );
  await assert.rejects(
    () => callTool(server, "tdoms_spool_action", {
      connectionId: "conn-1",
      action: "/delete",
      body: { spool: "S1" }
    }),
    /confirm: true/
  );

  assert.equal(calls.length, 0);
});

test("allows read-only action paths without confirmation", async () => {
  const { server, calls } = createHarness();

  await callTool(server, "tdoms_transfer_action", {
    connectionId: "conn-1",
    action: "/progress",
    body: { transferId: "x" }
  });
  await callTool(server, "tdoms_fill_object_action", {
    connectionId: "conn-1",
    action: "/jobStatus",
    body: { job: "x" }
  });
  await callTool(server, "tdoms_new_object_action", {
    connectionId: "conn-1",
    action: "/location",
    body: {
      applicationCode: "DEMOAPP",
      task: "T1002",
      environmentCode: "DEV",
      objectType: "*PGM",
      objectAttribute: "RPGLE"
    }
  });

  assert.deepEqual(
    calls.map(({ service, path }) => `${service}${path}`),
    ["OMQRTO/progress", "OMQRFO/jobStatus", "OMQRNO/location"]
  );
});

test("system info refreshes a stale saved token", async () => {
  let loginCount = 0;
  const { server, calls } = createHarness({
    loginHandler() {
      loginCount += 1;
      return "fresh-token";
    },
    getHandler({ token }) {
      if (token === "token") {
        throw new Error("TD/OMS GET /OMS/OMSINFO/system failed with 401: {}");
      }
      return { applications: [{ applicationCode: "DEMOAPP" }] };
    }
  });

  const response = await callTool(server, "tdoms_get_system_info", {
    connectionId: "conn-1"
  });

  assert.equal(response.structuredContent.ok, true);
  assert.equal(loginCount, 1);
  assert.deepEqual(
    calls.map(({ token }) => token),
    ["token", "fresh-token"]
  );
});

test("task search wrappers preserve programmer filters and pagination defaults", async () => {
  const { server, calls } = createHarness();

  await callTool(server, "tdoms_search_tasks", {
    connectionId: "conn-1",
    applicationCode: "DEMOAPP",
    programmer: "DEVUSER"
  });
  await callTool(server, "tdoms_task_search", {
    connectionId: "conn-1",
    applicationCode: "DEMOAPP",
    programmer: "DEVUSER"
  });

  for (const call of calls) {
    assert.equal(call.body.listInput.pageNumber, 1);
    assert.equal(call.body.listInput.recordsPerPage, 25);
    assert.ok(
      call.body.listInput.fieldSelections.some((selection) => selection.field === "programmer" && selection.value === "DEVUSER")
    );
  }
});

test("generic API caller covers dynamic APIs such as impact analysis", async () => {
  const { server, calls } = createHarness();

  await callTool(server, "tdoms_call_api", {
    connectionId: "conn-1",
    service: "OMQRIA",
    path: "/ref/CGPCHS/*PGM/RICHARD/CGPCHS",
    body: {},
    confirm: true
  });

  assert.equal(calls[0].service, "OMQRIA");
  assert.equal(calls[0].path, "/ref/CGPCHS/*PGM/RICHARD/CGPCHS");
});

test("registers organized family tools for extension-like workflows", () => {
  const { server } = createHarness();
  const tools = Object.keys(server._registeredTools).sort();

  assert.ok(tools.length >= 200, "family tool registration should substantially expand the MCP surface");
  for (const name of [
    "tdoms_connection_list",
    "tdoms_task_details",
    "tdoms_task_objects",
    "tdoms_source_compare",
    "tdoms_build_queue_list",
    "tdoms_compile_results",
    "tdoms_transfer_history",
    "tdoms_checkout_task",
    "tdoms_promote_task",
    "tdoms_analysis_impact",
    "tdoms_dashboard_execute"
  ]) {
    assert.ok(tools.includes(name), `${name} should be registered`);
  }
});

test("MCP clients can list tools without schema conversion errors", async () => {
  const { server } = createHarness();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "tdoms-test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 226);
    assert.ok(tools.tools.some((tool) => tool.name === "tdoms_connection_list"));
    assert.ok(tools.tools.some((tool) => tool.name === "tdoms_analysis_impact"));
    assert.ok(tools.tools.some((tool) => tool.name === "tdoms_new_object_create"));
    assert.ok(tools.tools.some((tool) => tool.name === "tdoms_transfer_select_targets"));
  } finally {
    await client.close();
  }
});

test("new family mutation wrappers require confirmation", async () => {
  const { server, calls } = createHarness();

  await assert.rejects(
    () => callTool(server, "tdoms_task_delete", {
      connectionId: "conn-1",
      body: { task: "T1001" }
    }),
    /confirm: true/
  );

  await assert.rejects(
    () => callTool(server, "tdoms_checkout_task", {
      connectionId: "conn-1",
      selectBody: { task: "T1001" }
    }),
    /confirm: true/
  );

  assert.equal(calls.length, 0);
});

test("new family read wrappers route to documented services", async () => {
  const { server, calls } = createHarness();

  await callTool(server, "tdoms_compile_event_raw_records", {
    connectionId: "conn-1",
    body: { library: "QTEMP", memberName: "CGPCHS" }
  });
  await callTool(server, "tdoms_analysis_impact", {
    connectionId: "conn-1",
    path: "/ref/CGPCHS/*PGM/RICHARD/CGPCHS",
    body: {}
  });

  assert.deepEqual(
    calls.map(({ service, path }) => `${service}${path}`),
    ["OMQREV/getRawRecords", "OMQRIA/ref/CGPCHS/*PGM/RICHARD/CGPCHS"]
  );
});

test("typed new-object wrappers map to documented OMQRNO bodies", async () => {
  const { server, calls } = createHarness();

  await callTool(server, "tdoms_new_object_location", {
    connectionId: "conn-1",
    applicationCode: "DEMOAPP",
    task: "T1002",
    environmentCode: "DEV",
    objectType: "*PGM",
    objectAttribute: "RPGLE"
  });
  await callTool(server, "tdoms_new_object_create", {
    connectionId: "conn-1",
    applicationCode: "DEMOAPP",
    task: "T1002",
    environmentCode: "DEV",
    newObject: "CGPPDS",
    newObjectLibrary: "DEMOLIB",
    newObjectType: "*PGM",
    newDescription: "Promotion Descriptions CGI",
    newAttribute: "RPGLE",
    newSourceFile: "QRPGLESRC",
    newSourceLibrary: "DEMOLIB",
    newSourceMember: "CGPPDS",
    newSourceAttribute: "RPGLE",
    confirm: true
  });
  await callTool(server, "tdoms_new_source_member_create", {
    connectionId: "conn-1",
    applicationCode: "DEMOAPP",
    task: "T1002",
    environmentCode: "DEV",
    newObject: "QRPGLESRC",
    newObjectLibrary: "DEMOLIB",
    newDetail: "CGPPDS",
    newDescription: "Promotion Descriptions CGI",
    newAttribute: "RPGLE",
    confirm: true
  });

  assert.deepEqual(
    calls.map(({ service, path }) => `${service}${path}`),
    ["OMQRNO/location", "OMQRNO/add", "OMQRNO/add"]
  );
  assert.deepEqual(calls[0].body, {
    applicationCode: "DEMOAPP",
    environmentCode: "DEV",
    task: "T1002",
    objectType: "*PGM",
    objectAttribute: "RPGLE"
  });
  assert.deepEqual(calls[1].body, {
    applicationCode: "DEMOAPP",
    task: "T1002",
    environmentCode: "DEV",
    copyObject: "0",
    newObject: "CGPPDS",
    newObjectLibrary: "DEMOLIB",
    newObjectType: "*PGM",
    newDetail: "",
    newDescription: "Promotion Descriptions CGI",
    newAttribute: "RPGLE",
    newSourceFile: "QRPGLESRC",
    newSourceLibrary: "DEMOLIB",
    newSourceMember: "CGPPDS",
    newSourceAttribute: "RPGLE",
    temporaryOrVirtualObject: "0"
  });
  assert.deepEqual(calls[2].body, {
    applicationCode: "DEMOAPP",
    task: "T1002",
    environmentCode: "DEV",
    copyObject: "0",
    newObject: "QRPGLESRC",
    newObjectLibrary: "DEMOLIB",
    newObjectType: "*FILE",
    newDetail: "CGPPDS",
    newDescription: "Promotion Descriptions CGI",
    newAttribute: "RPGLE",
    temporaryOrVirtualObject: "0"
  });
});

test("raw new-object action rejects misleading field names before calling TD/OMS", async () => {
  const { server, calls } = createHarness();

  await assert.rejects(
    () => callTool(server, "tdoms_new_object_action", {
      connectionId: "conn-1",
      action: "/add",
      body: {
        applicationCode: "DEMOAPP",
        fixNumber: "T1002",
        objectCode: "CGPPDS",
        objectType: "*PGM",
        objectLibrary: "DEMOLIB",
        objectAttribute: "RPGLE"
      },
      confirm: true
    }),
    /fixNumber -> task/
  );

  assert.equal(calls.length, 0);
});

test("typed transfer wrappers map checkout flow fields to documented OMQRTO bodies", async () => {
  const { server, calls } = createHarness();

  await callTool(server, "tdoms_transfer_select_targets", {
    connectionId: "conn-1",
    action: "Checkout",
    application: "DEMOAPP",
    taskNumber: "T1002",
    fromEnvironment: "UAT",
    objectList: [
      {
        objectCode: "SAMPLEPGM",
        objectType: "*MODULE",
        memberCode: "",
        routeCode: "",
        pathExtensionCode: ""
      }
    ]
  });
  await callTool(server, "tdoms_transfer_prepare", {
    connectionId: "conn-1",
    action: "Copy",
    application: "DEMOAPP",
    taskNumber: "T1002",
    fromEnvironment: "UAT",
    toEnvironment: "DEV",
    objects: [
      {
        objectCode: "SAMPLEPGM",
        objectType: "*MODULE",
        memberCode: "",
        routeCode: "",
        pathExtensionCode: ""
      }
    ],
    targetSubEnvironments: [],
    confirmation: true,
    confirm: true
  });
  await callTool(server, "tdoms_transfer_execute_number", {
    connectionId: "conn-1",
    transferNumber: "OT123456",
    schedules: [],
    confirm: true
  });
  await callTool(server, "tdoms_transfer_progress_number", {
    connectionId: "conn-1",
    transferNumber: "OT123456"
  });

  assert.deepEqual(
    calls.map(({ service, path }) => `${service}${path}`),
    ["OMQRTO/select", "OMQRTO/prepare", "OMQRTO/execute", "OMQRTO/progress"]
  );
  assert.deepEqual(calls[0].body, {
    action: "Checkout",
    taskNumber: "T1002",
    application: "DEMOAPP",
    fromEnvironment: "UAT",
    objectList: [
      {
        objectCode: "SAMPLEPGM",
        objectType: "*MODULE",
        memberCode: "",
        routeCode: "",
        pathExtensionCode: ""
      }
    ]
  });
  assert.deepEqual(calls[1].body, {
    action: "Copy",
    application: "DEMOAPP",
    taskNumber: "T1002",
    fromEnvironment: "UAT",
    toEnvironment: "DEV",
    objects: [
      {
        objectCode: "SAMPLEPGM",
        objectType: "*MODULE",
        memberCode: "",
        routeCode: "",
        pathExtensionCode: ""
      }
    ],
    targetSubEnvironments: [],
    confirmation: true
  });
  assert.deepEqual(calls[2].body, {
    transferNumber: "OT123456",
    schedules: []
  });
  assert.deepEqual(calls[3].body, {
    transferNumber: "OT123456"
  });
});

test("compile-and-check queues releases and parses events in one workflow", async () => {
  const { server, calls } = createHarness();

  await callTool(server, "tdoms_compile_and_check", {
    connectionId: "conn-1",
    applicationCode: "DEMOAPP",
    taskNumber: "T1002",
    objectCode: "CGPPDS",
    objectType: "*PGM",
    objectLibrary: "DEMOLIB",
    parseEvents: true,
    confirm: true
  });

  assert.deepEqual(
    calls.map(({ service, path }) => `${service}${path}`),
    ["OMQRSQ/queue", "OMQRSQ/release", "OMQREV/parseEvent"]
  );
  assert.deepEqual(calls[0].body, {
    applicationCode: "DEMOAPP",
    taskNumber: "T1002",
    objectCode: "CGPPDS",
    objectType: "*PGM",
    objectLibrary: "DEMOLIB",
    detail: "",
    processingArray: { clearAll: false }
  });
  assert.deepEqual(calls[2].body, {
    library: "DEMOLIB",
    memberName: "CGPPDS"
  });
});

test("source-all helpers read pages save chunks and patch literals", async () => {
  const sourcePages = {
    1: {
      canEdit: true,
      sourceCode: Buffer.from("line1\nold", "utf8").toString("base64"),
      ccsid: 37,
      pageNumber: 1,
      numberOfPages: 2,
      lastChangeDate: "2026-07-02-10.00.00.000000"
    },
    2: {
      canEdit: true,
      sourceCode: Buffer.from("\nline3", "utf8").toString("base64"),
      ccsid: 37,
      pageNumber: 2,
      numberOfPages: 2,
      lastChangeDate: "2026-07-02-10.00.00.000000"
    }
  };
  const { server, calls } = createHarness({
    postHandler: async ({ service, path, body }) => {
      if (service === "OMRSRC" && path === "/object/get") {
        return sourcePages[body.pageNumber];
      }
      return undefined;
    }
  });

  const readResult = await callTool(server, "tdoms_read_source_all", {
    connectionId: "conn-1",
    applicationCode: "DEMOAPP",
    taskNumber: "T1002",
    objectLibrary: "DEMOLIB",
    objectCode: "QRPGLESRC",
    objectType: "*FILE",
    memberCode: "CGPPDS"
  });

  assert.equal(readResult.structuredContent.sourceTextUtf8, "line1\nold\nline3");

  await callTool(server, "tdoms_save_source_all", {
    connectionId: "conn-1",
    applicationCode: "DEMOAPP",
    taskNumber: "T1002",
    objectLibrary: "DEMOLIB",
    objectCode: "QRPGLESRC",
    objectType: "*FILE",
    memberCode: "CGPPDS",
    sourceText: "abcd",
    lastChangeDate: "2026-07-02-10.00.00.000000",
    ccsid: 37,
    maxPageBytes: 2,
    confirm: true
  });

  await callTool(server, "tdoms_patch_source_literal", {
    connectionId: "conn-1",
    applicationCode: "DEMOAPP",
    taskNumber: "T1002",
    objectLibrary: "DEMOLIB",
    objectCode: "QRPGLESRC",
    objectType: "*FILE",
    memberCode: "CGPPDS",
    searchText: "old",
    replacementText: "new",
    confirm: true
  });

  assert.deepEqual(
    calls.map(({ service, path }) => `${service}${path}`),
    [
      "OMRSRC/object/get",
      "OMRSRC/object/get",
      "OMRSRC/object/save",
      "OMRSRC/object/save",
      "OMRSRC/object/get",
      "OMRSRC/object/get",
      "OMRSRC/object/save"
    ]
  );
  assert.equal(Buffer.from(calls[2].body.sourceCode, "base64").toString("utf8"), "ab");
  assert.equal(Buffer.from(calls[3].body.sourceCode, "base64").toString("utf8"), "cd");
  assert.equal(Buffer.from(calls[6].body.sourceCode, "base64").toString("utf8"), "line1\nnew\nline3");
  assert.equal(calls[6].body.lastChangeDate, "2026-07-02-10.00.00.000000");
});

test("core profile exposes only the universal agent-neutral tools", async () => {
  const { server } = createHarness({ profile: "core" });
  const tools = Object.keys(server._registeredTools).sort();

  assert.deepEqual(tools, [
    "tdoms_discover_options",
    "tdoms_execute_workflow",
    "tdoms_get_current_context",
    "tdoms_get_workflow_status",
    "tdoms_list_capabilities",
    "tdoms_list_connections",
    "tdoms_plan_workflow"
  ]);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "tdoms-core-test", version: "0.0.0" });
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 7);
  } finally {
    await client.close();
  }
});

test("current context selects the only connection and derives programmer identity", async () => {
  const { server, calls } = createHarness({
    profile: "core",
    getHandler({ service, path }) {
      if (service === "OMSINFO" && path === "/system") {
        return {
          applications: [{
            applicationCode: "DEMOAPP",
            applicationName: "DEMOAPP",
            developmentEnvironment: "DEV",
            productionEnvironment: "*PRD",
            isProgrammer: true
          }]
        };
      }
      return undefined;
    }
  });

  const response = await callTool(server, "tdoms_get_current_context", {});

  assert.equal(response.structuredContent.user.tdomsUsername, "tester");
  assert.equal(response.structuredContent.user.programmerId, "TESTER");
  assert.equal(response.structuredContent.system.applications[0].applicationCode, "DEMOAPP");
  assert.deepEqual(calls.map(({ service, path }) => `${service}${path}`), ["OMSINFO/system"]);
});

test("option discovery normalizes system and database choices", async () => {
  const { server } = createHarness({
    profile: "core",
    getHandler({ service, path }) {
      if (service === "OMSINFO" && path === "/system") {
        return {
          applications: [
            { applicationCode: "DEMOAPP", applicationName: "Demo Change Management", developmentEnvironment: "DEV", productionEnvironment: "*PRD" },
            { applicationCode: "TESTAPP", applicationName: "Demo Test", developmentEnvironment: "DEV", productionEnvironment: "*PRD" }
          ]
        };
      }
      return undefined;
    },
    postHandler({ service, path, body }) {
      if (service === "OMRDBA" && path === "/get" && body.listInput.table === "OMXFix") {
        return { records: [{ programmer: "DEVUSER" }, { programmer: "DEVUSER" }, { programmer: "OTHER" }] };
      }
      return undefined;
    }
  });

  const environments = await callTool(server, "tdoms_discover_options", {
    optionSet: "environments",
    context: {}
  });
  assert.deepEqual(environments.structuredContent.options.map(({ value }) => value), ["DEV", "*PRD"]);

  const programmers = await callTool(server, "tdoms_discover_options", {
    optionSet: "programmers",
    context: { applicationCode: "DEMOAPP" },
    search: "dev"
  });
  assert.equal(programmers.structuredContent.supported, true);
  assert.deepEqual(programmers.structuredContent.options.map(({ value }) => value), ["DEVUSER"]);
  assert.equal(programmers.structuredContent.source.authoritative, false);
  assert.match(programmers.structuredContent.warnings[0], /inferred/);
});

test("core task reads default to the saved TD/OMS programmer identity", async () => {
  const { server, calls } = createHarness({
    profile: "core",
    postHandler({ service, path }) {
      if (service === "OMRDBA" && path === "/get") {
        return { records: [{ fixNumber: "T1003", shortFixDescription: "Example task", programmer: "TESTER" }] };
      }
      return undefined;
    }
  });

  const response = await callTool(server, "tdoms_discover_options", {
    optionSet: "tasks",
    context: { applicationCode: "DEMOAPP" }
  });

  assert.equal(response.structuredContent.options[0].value, "T1003");
  assert.ok(calls[0].body.listInput.fieldSelections.some(({ field, value }) => field === "programmer" && value === "TESTER"));
});

test("option discovery surfaces TD/OMS terminal responses and normalizes dashboard fields", async () => {
  const { server } = createHarness({
    profile: "core",
    postHandler({ service, path, body }) {
      if (service === "OMRDBA" && path === "/get" && body.listInput.table === "OMXFix") {
        return { returnStatus: { status: "*TERM", messages: [{ messageText: "Invalid option source" }] }, records: [] };
      }
      if (service === "OMRDBA" && path === "/get" && body.listInput.table === "OMDSH") {
        return { returnStatus: { status: "*NORM" }, records: [{ uUID: "10", descriptionType: "Missing Source" }] };
      }
      return undefined;
    }
  });

  const failed = await callTool(server, "tdoms_discover_options", { optionSet: "programmers", context: {} });
  assert.equal(failed.structuredContent.supported, false);
  assert.match(failed.structuredContent.warnings[0], /Invalid option source/);

  const dashboards = await callTool(server, "tdoms_discover_options", { optionSet: "dashboards", context: {} });
  assert.deepEqual(dashboards.structuredContent.options.map(({ value, label }) => ({ value, label })), [{ value: "10", label: "Missing Source" }]);
});

test("dependency discovery flattens Octo-style report trees", async () => {
  const { server } = createHarness({
    profile: "core",
    getHandler({ service }) {
      if (service === "OMQRIA") {
        return {
          reportResult: {
            objectCode: "ROOT",
            objectDescription: "Root program",
            refLink: "/ref/ROOT/*PGM/LIB/*NONE",
            children: [{ name: "using -->", children: [{ objectCode: "CHILD", objectDescription: "Child file", refLink: "/ref/CHILD/*FILE/LIB/*NONE" }] }]
          }
        };
      }
      return undefined;
    }
  });

  const response = await callTool(server, "tdoms_discover_options", {
    optionSet: "dependencies",
    context: { path: "/ref/ROOT/*PGM/LIB/*NONE" }
  });

  assert.deepEqual(response.structuredContent.options.map(({ value, label }) => ({ value, label })), [
    { value: "/ref/ROOT/*PGM/LIB/*NONE", label: "Root program" },
    { value: "/ref/CHILD/*FILE/LIB/*NONE", label: "Child file" }
  ]);
});

test("new-object location discovery exposes scalar TD/OMS defaults", async () => {
  const { server } = createHarness({
    profile: "core",
    postHandler({ service, path }) {
      if (service === "OMQRNO" && path === "/location") {
        return { status: "*NORM", objectLibrary: "DEVLIB", sourceLibrary: "DEVLIB", sourceFile: "QRPGLESRC" };
      }
      return undefined;
    }
  });

  const response = await callTool(server, "tdoms_discover_options", {
    optionSet: "objectLocations",
    context: { applicationCode: "DEMOAPP", taskNumber: "T1", environmentCode: "DEV", objectType: "*PGM", objectAttribute: "RPGLE" }
  });

  assert.deepEqual(response.structuredContent.options.map(({ value }) => value), ["DEVLIB", "QRPGLESRC"]);
});

test("capability registry covers every Octo wizard mapping", async () => {
  const { server } = createHarness({ profile: "core" });
  const response = await callTool(server, "tdoms_list_capabilities", {});
  const capabilities = response.structuredContent.capabilities;

  assert.equal(capabilities.length, 28);
  assert.equal(new Set(capabilities.map(({ octoWizard }) => octoWizard)).size, 28);
  assert.ok(capabilities.some(({ id, support }) => id === "tracker-server-manager" && support === "unsupported"));
  assert.ok(capabilities.some(({ id, execution }) => id === "transfer" && execution.service === "OMQRTO"));
});

test("workflow planning is read-only and execution requires confirmation", async () => {
  let now = Date.parse("2026-07-15T12:00:00Z");
  const { server, calls } = createHarness({ profile: "core", clock: () => now });

  const planned = await callTool(server, "tdoms_plan_workflow", {
    workflow: "change-programmer",
    context: { applicationCode: "DEMOAPP", taskNumber: "T1003" },
    selections: { requestBody: { applicationCode: "DEMOAPP", fixNumber: "T1003", programmer: "OTHER" } }
  });
  const planId = planned.structuredContent.planId;

  assert.ok(planId);
  assert.deepEqual(calls.map(({ service, path }) => `${service}${path}`), ["OMRDBA/get"]);
  await assert.rejects(() => callTool(server, "tdoms_execute_workflow", { planId, confirm: false }), /confirm: true/);
  assert.equal(calls.length, 1);

  const executed = await callTool(server, "tdoms_execute_workflow", { planId, confirm: true });
  assert.equal(executed.structuredContent.state, "executed");
  assert.deepEqual(calls.map(({ service, path }) => `${service}${path}`), ["OMRDBA/get", "OMRDBA/get", "OMQRTA/change"]);

  const status = await callTool(server, "tdoms_get_workflow_status", { planId });
  assert.equal(status.structuredContent.state, "executed");
  now += 1;
  await assert.rejects(() => callTool(server, "tdoms_execute_workflow", { planId, confirm: true }), /executed/);
});

test("workflow execution rejects expired and stale plans", async () => {
  let now = Date.parse("2026-07-15T12:00:00Z");
  let stateVersion = "DEV";
  const { server } = createHarness({
    profile: "core",
    clock: () => now,
    postHandler({ service, path }) {
      if (service === "OMRDBA" && path === "/get") return { records: [{ fixStatus: stateVersion }] };
      return undefined;
    }
  });

  const expiring = await callTool(server, "tdoms_plan_workflow", {
    workflow: "complete-task",
    context: { applicationCode: "DEMOAPP", taskNumber: "T1003" },
    selections: { requestBody: { applicationCode: "DEMOAPP", fixNumber: "T1003" } }
  });
  now += 10 * 60 * 1000;
  await assert.rejects(
    () => callTool(server, "tdoms_execute_workflow", { planId: expiring.structuredContent.planId, confirm: true }),
    /expired/
  );

  now += 1;
  const stale = await callTool(server, "tdoms_plan_workflow", {
    workflow: "complete-task",
    context: { applicationCode: "DEMOAPP", taskNumber: "T1003" },
    selections: { requestBody: { applicationCode: "DEMOAPP", fixNumber: "T1003" } }
  });
  stateVersion = "*CMP";
  await assert.rejects(
    () => callTool(server, "tdoms_execute_workflow", { planId: stale.structuredContent.planId, confirm: true }),
    /state changed/
  );
});

test("workflow plans validate selected options again before execution", async () => {
  let programmerAvailable = true;
  const { server, calls } = createHarness({
    profile: "core",
    postHandler({ service, path, body }) {
      if (service === "OMRDBA" && path === "/get" && body.listInput.table === "OMXFix") {
        return { records: programmerAvailable ? [{ programmer: "OTHER" }] : [] };
      }
      if (service === "OMRDBA" && path === "/get") return { records: [{ fixStatus: "DEV" }] };
      return undefined;
    }
  });

  const invalid = await callTool(server, "tdoms_plan_workflow", {
    workflow: "change-programmer",
    context: { applicationCode: "DEMOAPP", taskNumber: "T1003" },
    selections: { requestBody: { applicationCode: "DEMOAPP", fixNumber: "T1003", programmer: "MISSING" } },
    optionSelections: { programmers: "MISSING" }
  });
  assert.equal(invalid.structuredContent.ok, false);
  assert.match(invalid.structuredContent.blockers[0], /not a current programmers choice/);

  const planned = await callTool(server, "tdoms_plan_workflow", {
    workflow: "change-programmer",
    context: { applicationCode: "DEMOAPP", taskNumber: "T1003" },
    selections: { requestBody: { applicationCode: "DEMOAPP", fixNumber: "T1003", programmer: "OTHER" } },
    optionSelections: { programmers: "OTHER" }
  });
  assert.equal(planned.structuredContent.ok, true);

  programmerAvailable = false;
  await assert.rejects(
    () => callTool(server, "tdoms_execute_workflow", { planId: planned.structuredContent.planId, confirm: true }),
    /options changed/
  );
  assert.ok(!calls.some(({ service, path }) => service === "OMQRTA" && path === "/change"));
});
