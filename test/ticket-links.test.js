import assert from "node:assert/strict";
import test from "node:test";
import { createMcpServer } from "../src/mcp-server.js";
import {
  buildLinkTicketBody,
  buildUnlinkTicketBody,
  chooseProduct,
  normalizeTicketFields,
  resolveTicketRequest
} from "../src/ticket-links.js";

const TRACKER = "https://tracker.example.test";
const API_ROW = (taskNumber, id, extra = {}) => ({
  applicationCode: "DEMO",
  taskNumber,
  requestNumber: "",
  productCode: "JIRA",
  urlToItem: `${TRACKER}/rest/api/latest/issue/${id}`,
  urlToProduct: TRACKER,
  uUID: id,
  disableIndicator: "0",
  remoteIssueInformation: `DEMO-${id} : Sample issue`,
  ...extra
});

test("link body uses the LinkTicketRequest field names", () => {
  const body = buildLinkTicketBody({
    applicationCode: "DEMO",
    taskNumber: "T0042",
    freeFormatProductId: "JIRA",
    urlToItem: `${TRACKER}/rest/api/latest/issue/10042`,
    urlToProduct: TRACKER,
    universalUniqueId: "10042",
    remoteIssueInformation: "DEMO-12 : Sample issue"
  });
  assert.deepEqual(body, {
    applicationCode: "DEMO",
    taskNumber: "T0042",
    freeFormatProductId: "JIRA",
    urlToItem: `${TRACKER}/rest/api/latest/issue/10042`,
    urlToProduct: TRACKER,
    universalUniqueId: "10042",
    disableIndicator: "0",
    remoteIssueInformation: "DEMO-12 : Sample issue"
  });
});

test("unlink body uses the UnlinkTicketRequest field names only", () => {
  const body = buildUnlinkTicketBody({
    applicationCode: "DEMO",
    taskNumber: "T0042",
    freeFormatProductId: "JIRA",
    urlToItem: `${TRACKER}/rest/api/latest/issue/10042`,
    urlToProduct: TRACKER,
    universalUniqueId: "10042"
  });
  assert.deepEqual(Object.keys(body).sort(), ["applicationCode", "freeFormatProductId", "taskNumber", "urlToItem"]);
});

test("read-side and friendly names map to request fields", () => {
  const fields = normalizeTicketFields({
    applicationCode: "DEMO",
    taskNumber: "T0042",
    productCode: "JIRA",
    uUID: "10042",
    issueUrl: `${TRACKER}/browse/DEMO-12`,
    trackerUrl: TRACKER,
    issueTitle: "Sample issue",
    issueKey: "DEMO-12",
    createdBy: "SOMEONE"
  });
  assert.deepEqual(fields, {
    applicationCode: "DEMO",
    taskNumber: "T0042",
    freeFormatProductId: "JIRA",
    universalUniqueId: "10042",
    urlToItem: `${TRACKER}/browse/DEMO-12`,
    urlToProduct: TRACKER,
    remoteIssueInformation: "Sample issue"
  });
  const canonicalWins = normalizeTicketFields({ productCode: "OLD", freeFormatProductId: "NEW" });
  assert.equal(canonicalWins.freeFormatProductId, "NEW");
  const unlink = normalizeTicketFields({ applicationCode: "DEMO", taskNumber: "T0042", productCode: "JIRA", urlToItem: "x", uUID: "1" }, "unlink");
  assert.equal(unlink.universalUniqueId, undefined);
});

test("a single tracker product is chosen; case variants count as one", () => {
  assert.deepEqual(chooseProduct([{ productCode: "JIRA", urlToProduct: TRACKER }, { productCode: "Jira", urlToProduct: `${TRACKER}/` }]).productId, "JIRA");
  const several = chooseProduct([{ productCode: "JIRA", urlToProduct: TRACKER }, { productCode: "Freshdesk", urlToProduct: "https://desk.example.test" }]);
  assert.equal(several.productId, undefined);
  assert.deepEqual(several.choices, ["JIRA", "Freshdesk"]);
  assert.equal(chooseProduct([{ productCode: "JIRA", urlToProduct: TRACKER }, { productCode: "Freshdesk", urlToProduct: "https://desk.example.test" }], { host: "tracker.example.test" }).productId, "JIRA");
});

test("plan resolution defaults the single product and builds the API URL the site stores", () => {
  const resolved = resolveTicketRequest({
    input: { applicationCode: "DEMO", taskNumber: "T0042", issueKey: "DEMO-12", issueUrl: `${TRACKER}/browse/DEMO-12`, issueId: "10042", issueTitle: "Sample issue" },
    products: [{ productCode: "JIRA", urlToProduct: TRACKER }],
    recentRows: [API_ROW("T0040", "10040"), API_ROW("T0041", "10041")],
    taskRows: []
  });
  assert.deepEqual(resolved.body, {
    applicationCode: "DEMO",
    taskNumber: "T0042",
    freeFormatProductId: "JIRA",
    urlToItem: `${TRACKER}/rest/api/latest/issue/10042`,
    urlToProduct: TRACKER,
    universalUniqueId: "10042",
    disableIndicator: "0",
    remoteIssueInformation: "DEMO-12 : Sample issue"
  });
  assert.equal(resolved.defaultsApplied.freeFormatProductId, "JIRA");
  assert.equal(resolved.defaultsApplied.urlToItem, `${TRACKER}/rest/api/latest/issue/10042`);
  assert.ok(!("issueKey" in resolved.body) && !("issueUrl" in resolved.body));
});

test("plan resolution stops when the product is ambiguous or unknown", () => {
  const input = { applicationCode: "DEMO", taskNumber: "T0042", issueUrl: `${TRACKER}/rest/api/latest/issue/10042` };
  const none = resolveTicketRequest({ input, products: [], recentRows: [], taskRows: [] });
  assert.equal(none.body, undefined);
  assert.match(none.blockers[0], /No tracker product/);
  const several = resolveTicketRequest({
    input: { applicationCode: "DEMO", taskNumber: "T0042", issueId: "10042" },
    products: [{ productCode: "JIRA", urlToProduct: TRACKER }, { productCode: "Freshdesk", urlToProduct: "https://desk.example.test" }],
    recentRows: [],
    taskRows: []
  });
  assert.match(several.blockers[0], /Several tracker products.*JIRA, Freshdesk/);
});

test("plan resolution asks for the issue id when only a web URL is given on an API-URL site", () => {
  const resolved = resolveTicketRequest({
    input: { applicationCode: "DEMO", taskNumber: "T0042", issueUrl: `${TRACKER}/browse/DEMO-12` },
    products: [{ productCode: "JIRA", urlToProduct: TRACKER }],
    recentRows: [API_ROW("T0040", "10040")],
    taskRows: []
  });
  assert.match(resolved.blockers[0], /API URL/);
});

test("plan resolution reports an existing link instead of posting again", () => {
  const resolved = resolveTicketRequest({
    input: { applicationCode: "DEMO", taskNumber: "T0042", issueId: "10042" },
    products: [{ productCode: "JIRA", urlToProduct: TRACKER }],
    recentRows: [API_ROW("T0040", "10040")],
    taskRows: [API_ROW("T0042", "10042")]
  });
  assert.equal(resolved.alreadyLinked, true);
  assert.equal(resolved.body, undefined);
});

test("unlink resolution takes the product and URL from the existing link", () => {
  const resolved = resolveTicketRequest({
    kind: "unlink",
    input: { applicationCode: "DEMO", taskNumber: "T0042", issueId: "10042" },
    taskRows: [API_ROW("T0042", "10042")]
  });
  assert.deepEqual(resolved.body, {
    applicationCode: "DEMO",
    taskNumber: "T0042",
    freeFormatProductId: "JIRA",
    urlToItem: `${TRACKER}/rest/api/latest/issue/10042`
  });
  const missing = resolveTicketRequest({ kind: "unlink", input: { applicationCode: "DEMO", taskNumber: "T0042", issueId: "1" }, taskRows: [] });
  assert.match(missing.blockers[0], /no matching ticket link/);
});

function createHarness({ linkRows = [], products = [] } = {}) {
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
        const list = body.listInput;
        if (list.table !== "OMXRequestTaskLink") return { returnStatus: { status: "*NORM" }, records: [] };
        if (list.distinct) return { returnStatus: { status: "*NORM" }, records: products };
        const task = list.fieldSelections?.find((selection) => selection.field === "taskNumber");
        assert.ok(!list.fieldSelections?.some((selection) => selection.field === "fixNumber"), "OMXRequestTaskLink has no fixNumber field");
        const rows = task ? linkRows.filter((row) => row.taskNumber === task.value) : linkRows;
        return { returnStatus: { status: "*NORM" }, records: rows };
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

test("link-task-to-issue plans and posts the LinkTicketRequest body", async () => {
  const { calls, server } = createHarness({
    linkRows: [API_ROW("T0040", "10040")],
    products: [{ productCode: "JIRA", urlToProduct: TRACKER }]
  });
  const plan = await callTool(server, "tdoms_plan_workflow", {
    workflow: "link-task-to-issue",
    context: { applicationCode: "DEMO", taskNumber: "T0042" },
    selections: { issueKey: "DEMO-12", issueUrl: `${TRACKER}/browse/DEMO-12`, issueId: "10042", issueTitle: "Sample issue" }
  });
  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.equal(plan.defaultsApplied.freeFormatProductId, "JIRA");
  assert.equal(plan.preview.body.freeFormatProductId, "JIRA");
  assert.equal(plan.preview.body.urlToItem, `${TRACKER}/rest/api/latest/issue/10042`);
  assert.equal(calls.filter((call) => call.service === "OMQRTA").length, 0);

  await callTool(server, "tdoms_execute_workflow", { planId: plan.planId, confirm: true });
  const posted = calls.find((call) => call.service === "OMQRTA");
  assert.equal(posted.path, "/link/ticket");
  assert.deepEqual(Object.keys(posted.body).sort(), ["applicationCode", "disableIndicator", "freeFormatProductId", "remoteIssueInformation", "taskNumber", "universalUniqueId", "urlToItem", "urlToProduct"]);
});

test("link-task-to-issue reports an existing link and never posts", async () => {
  const { calls, server } = createHarness({
    linkRows: [API_ROW("T0042", "10042")],
    products: [{ productCode: "JIRA", urlToProduct: TRACKER }]
  });
  const plan = await callTool(server, "tdoms_plan_workflow", {
    workflow: "link-task-to-issue",
    context: { applicationCode: "DEMO", taskNumber: "T0042" },
    selections: { issueId: "10042" }
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.alreadyLinked, true);
  assert.equal(calls.filter((call) => call.service === "OMQRTA").length, 0);
});

test("direct link tool validates blank fields before calling TD/OMS", async () => {
  const { calls, server } = createHarness();
  await assert.rejects(
    () => callTool(server, "tdoms_task_link_ticket", { applicationCode: "DEMO", taskNumber: "T0042", urlToItem: `${TRACKER}/rest/api/latest/issue/10042`, confirm: true }),
    /freeFormatProductId must not be blank/
  );
  await assert.rejects(
    () => callTool(server, "tdoms_task_link_ticket", { body: { applicationCode: "DEMO", taskNumber: "T0042", productCode: "JIRA" }, confirm: true }),
    /urlToItem must not be blank/
  );
  assert.equal(calls.length, 0);
});

test("direct link tool previews first, accepts read-side aliases, and posts on confirm", async () => {
  const { calls, server } = createHarness();
  const input = { applicationCode: "DEMO", taskNumber: "T0042", productCode: "JIRA", uUID: "10042", urlToItem: `${TRACKER}/rest/api/latest/issue/10042`, urlToProduct: TRACKER, remoteIssueInformation: "DEMO-12 : Sample issue" };
  const preview = await callTool(server, "tdoms_task_link_ticket", input);
  assert.equal(preview.preview, true);
  assert.equal(preview.body.freeFormatProductId, "JIRA");
  assert.equal(preview.body.universalUniqueId, "10042");
  assert.ok(!("productCode" in preview.body) && !("uUID" in preview.body));
  assert.equal(calls.filter((call) => call.service === "OMQRTA").length, 0);

  const sent = await callTool(server, "tdoms_task_link_ticket", { ...input, confirm: true });
  assert.equal(sent.posted, true);
  const posted = calls.find((call) => call.service === "OMQRTA");
  assert.equal(posted.path, "/link/ticket");
  assert.deepEqual(posted.body, preview.body);
});

test("generic task action normalizes ticket bodies and rejects blank product ids", async () => {
  const { calls, server } = createHarness();
  await assert.rejects(
    () => server._registeredTools.tdoms_task_action.handler({ connectionId: "conn-1", action: "/link/ticket", body: { applicationCode: "DEMO", taskNumber: "T0042", urlToItem: "x" }, confirm: true }),
    /freeFormatProductId must not be blank/
  );
  assert.equal(calls.length, 0);
});

test("task ticket reads query OMXRequestTaskLink by taskNumber", async () => {
  const { calls, server } = createHarness({ linkRows: [API_ROW("T0042", "10042")] });
  const response = await callTool(server, "tdoms_task_tickets", { connectionId: "conn-1", applicationCode: "DEMO", taskNumber: "T0042" });
  assert.equal(response.table, "OMXRequestTaskLink");
  assert.equal(response.response.records.length, 1);
  const selection = calls[0].body.listInput.fieldSelections.find((entry) => entry.value === "T0042");
  assert.equal(selection.field, "taskNumber");
});
