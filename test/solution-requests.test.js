import assert from "node:assert/strict";
import test from "node:test";
import { createMcpServer } from "../src/mcp-server.js";
import {
  buildConnectRequest,
  buildMultiChangeRequest,
  buildMultiDisconnectRequest,
  buildMultiLockRequest,
  buildMultiMoveRequest,
  buildMultiUnlockRequest,
  selectSolutions
} from "../src/solution-requests.js";

const row = (objectCode, extra = {}) => ({
  applicationCode: "DEMO",
  fixNumber: "T0042",
  objectCode,
  objectType: "*PGM",
  memberCode: "",
  objectLibrary: "DEVLIB",
  objectClass: "0",
  routeCode: "",
  pathExtensionLibraryCode: "",
  iFSObjectCode: objectCode,
  iFSDirectoryCode: null,
  solutionType: "1",
  sourceProcessing: "1",
  overrideCode: "",
  ...extra
});

const ROWS = [row("ORDENTRY"), row("ORDPRINT"), row("ORDFILE", { objectType: "*FILE", memberCode: "ORDFILE" })];

test("multiDisconnect request nests options and data taken from the solution row", () => {
  const body = buildMultiDisconnectRequest([row("ORDENTRY", { routeCode: "R1", pathExtensionLibraryCode: "EXT1" })]);
  assert.deepEqual(body, {
    interfaceLevel: "V3R0M0",
    multiDisconnectProcessingOptions: { updateBuffer: "1", updateDb: "1", deleteObjectAndSource: "0" },
    multiDisconnectData: [{
      applicationCode: "DEMO",
      fixNumber: "T0042",
      objectCode: "ORDENTRY",
      objectType: "*PGM",
      memberCode: "",
      routeCode: "R1",
      pathExtensionLibraryCode: "EXT1"
    }]
  });
  assert.equal(buildMultiDisconnectRequest(ROWS.slice(0, 1), { deleteObjectAndSource: true }).multiDisconnectProcessingOptions.deleteObjectAndSource, "1");
  assert.ok(!("taskNumber" in body.multiDisconnectData[0]) && !("objectLibrary" in body.multiDisconnectData[0]));
});

test("IFS solutions are identified by directory and IFS object", () => {
  const ifs = row("", { objectClass: "B", objectType: "*STMF", iFSObjectCode: "app.js", iFSDirectoryCode: "/www/demo" });
  assert.deepEqual(buildMultiDisconnectRequest([ifs]).multiDisconnectData[0], {
    applicationCode: "DEMO", fixNumber: "T0042", iFSDirectoryCode: "/www/demo", iFSObjectCode: "app.js", objectType: "*STMF"
  });
});

test("lock, unlock, move and change use their multi request shapes", () => {
  const lock = buildMultiLockRequest(ROWS.slice(0, 1));
  assert.deepEqual(Object.keys(lock).sort(), ["interfaceLevel", "multiLockData", "multiLockProcessingOptions"]);
  assert.equal(lock.multiLockData[0].iFSObjectCode, "*OBJC");
  const unlock = buildMultiUnlockRequest(ROWS.slice(0, 1));
  assert.deepEqual(unlock.multiUnlockProcessingOptions, { updateBuffer: "1", updateDb: "1", forceActiveSolution: "0" });
  const move = buildMultiMoveRequest(ROWS.slice(0, 1), "T0043");
  assert.equal(move.multiMoveProcessingOptions.toFix, "T0043");
  assert.ok(!("routeCode" in move.multiMoveData[0]));
  const change = buildMultiChangeRequest(ROWS.slice(0, 1), { solutionType: "2" });
  assert.equal(change.multiChangeData[0].solutionType, "2");
  assert.equal(change.multiChangeData[0].sourceProcessing, "1");
  assert.equal(change.multiChangeData[0].longDescription, "*SAME");
});

test("connect request nests connectData with fixNumber", () => {
  const body = buildConnectRequest({ applicationCode: "DEMO", taskNumber: "T0042", objectCode: "ORDENTRY", objectType: "*PGM", objectLibrary: "PRODLIB", environmentCode: "PRD" });
  assert.deepEqual(body, {
    interfaceLevel: "V3R0M0",
    connectProcessingOptions: { updateBuffer: "1", updateDb: "1" },
    connectData: { applicationCode: "DEMO", fixNumber: "T0042", objectCode: "ORDENTRY", objectType: "*PGM", objectLibrary: "PRODLIB", environmentCode: "PRD" }
  });
});

test("selecting a solution that is not on the task is a blocker", () => {
  const missing = selectSolutions(ROWS, [{ objectCode: "NOTHERE", objectType: "*PGM" }], { applicationCode: "DEMO", taskNumber: "T0042" });
  assert.equal(missing.rows, undefined);
  assert.match(missing.blockers[0], /NOTHERE \*PGM is not a solution on task DEMO T0042/);
  const wrongType = selectSolutions(ROWS, [{ objectCode: "ORDENTRY", objectType: "*FILE" }]);
  assert.ok(wrongType.blockers);
  assert.equal(selectSolutions(ROWS, [{ objectCode: "ordentry", objectType: "*pgm", objectLibrary: "DEVLIB" }]).rows[0].objectCode, "ORDENTRY");
});

function createHarness(rows = ROWS) {
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
      if (service === "OMRDBA") {
        const records = body.listInput.table === "OMXSolutionExtended" ? rows : [];
        return { returnStatus: { status: "*NORM" }, listStatus: { totalRecords: records.length }, records };
      }
      return { returnStatus: { status: "*NORM" } };
    }
  });
  return { calls, server: createMcpServer({ store, clientFactory, profile: "full" }) };
}

async function callTool(server, name, input) {
  const tool = server._registeredTools[name];
  assert.ok(tool, `Tool not registered: ${name}`);
  return (await tool.handler(input)).structuredContent;
}

test("disconnect-solutions plans from the task's rows and posts multiDisconnect", async () => {
  const { calls, server } = createHarness();
  const plan = await callTool(server, "tdoms_plan_workflow", {
    workflow: "disconnect-solutions",
    context: { applicationCode: "DEMO", taskNumber: "T0042" },
    selections: { objectCode: "ORDENTRY", objectType: "*PGM", objectLibrary: "DEVLIB" }
  });
  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.equal(plan.preview.execution.path, "/multiDisconnect");
  assert.match(plan.preview.effect, /Disconnect only/);
  assert.equal(plan.preview.body.multiDisconnectData.length, 1);
  assert.equal(calls.filter((call) => call.service === "OMQRSO").length, 0);

  await callTool(server, "tdoms_execute_workflow", { planId: plan.planId, confirm: true });
  const posted = calls.find((call) => call.service === "OMQRSO");
  assert.equal(posted.path, "/multiDisconnect");
  assert.deepEqual(posted.body, plan.preview.body);
});

test("disconnect-solutions shows deletion plainly when it is selected", async () => {
  const { server } = createHarness();
  const plan = await callTool(server, "tdoms_plan_workflow", {
    workflow: "disconnect-solutions",
    context: { applicationCode: "DEMO", taskNumber: "T0042" },
    selections: { solutions: [{ objectCode: "ORDENTRY", objectType: "*PGM" }, { objectCode: "ORDPRINT", objectType: "*PGM" }], deleteObjectAndSource: true }
  });
  assert.equal(plan.preview.body.multiDisconnectProcessingOptions.deleteObjectAndSource, "1");
  assert.match(plan.preview.effect, /DELETE the object and source/);
  assert.equal(plan.preview.body.multiDisconnectData.length, 2);
});

test("disconnect-solutions stops when the solution is not on the task", async () => {
  const { calls, server } = createHarness();
  const plan = await callTool(server, "tdoms_plan_workflow", {
    workflow: "disconnect-solutions",
    context: { applicationCode: "DEMO", taskNumber: "T0042" },
    selections: { objectCode: "NOTHERE", objectType: "*PGM" }
  });
  assert.equal(plan.ok, false);
  assert.match(plan.blockers[0], /not a solution on task/);
  assert.equal(calls.filter((call) => call.service === "OMQRSO").length, 0);
});

test("typed solution tools preview first and refuse solutions not on the task", async () => {
  const { calls, server } = createHarness();
  const preview = await callTool(server, "tdoms_solution_disconnect", { applicationCode: "DEMO", taskNumber: "T0042", objectCode: "ORDFILE", objectType: "*FILE", memberCode: "ORDFILE" });
  assert.equal(preview.preview, true);
  assert.equal(preview.body.multiDisconnectData[0].memberCode, "ORDFILE");
  await assert.rejects(
    () => callTool(server, "tdoms_solution_disconnect", { applicationCode: "DEMO", taskNumber: "T0042", objectCode: "NOTHERE", objectType: "*PGM", confirm: true }),
    /not a solution on task/
  );
  assert.equal(calls.filter((call) => call.service === "OMQRSO").length, 0);

  const sent = await callTool(server, "tdoms_solution_lock", { applicationCode: "DEMO", taskNumber: "T0042", objectCode: "ORDPRINT", objectType: "*PGM", confirm: true });
  assert.equal(sent.posted, true);
  assert.equal(calls.find((call) => call.service === "OMQRSO").path, "/multiLock");
});

test("move-solutions and change-solution-type post multi requests", async () => {
  const { calls, server } = createHarness();
  const move = await callTool(server, "tdoms_plan_workflow", {
    workflow: "move-solutions",
    context: { applicationCode: "DEMO", taskNumber: "T0042" },
    selections: { objectCode: "ORDENTRY", objectType: "*PGM", toTaskNumber: "T0043" }
  });
  assert.equal(move.preview.execution.path, "/multiMove");
  assert.equal(move.preview.body.multiMoveProcessingOptions.toFix, "T0043");
  const change = await callTool(server, "tdoms_plan_workflow", {
    workflow: "change-solution-type",
    context: { applicationCode: "DEMO", taskNumber: "T0042" },
    selections: { objectCode: "ORDENTRY", objectType: "*PGM", solutionType: "2" }
  });
  assert.equal(change.preview.execution.path, "/multiChange");
  await callTool(server, "tdoms_execute_workflow", { planId: change.planId, confirm: true });
  assert.equal(calls.find((call) => call.service === "OMQRSO").path, "/multiChange");
});

test("raw solution action rejects a flat body before calling TD/OMS", async () => {
  const { calls, server } = createHarness();
  await assert.rejects(
    () => server._registeredTools.tdoms_solution_action.handler({ connectionId: "conn-1", action: "/disconnect", body: { applicationCode: "DEMO", taskNumber: "T0042", objectCode: "ORDENTRY" }, confirm: true }),
    /needs a nested body with solutionData/
  );
  assert.equal(calls.length, 0);
});
