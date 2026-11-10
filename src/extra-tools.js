// Tools added for Octo 1.6 parity and for app integration. They are registered on
// the tool catalog; tool-groups.js decides which group each one belongs to.

import { z } from "zod";
import { ebcdicToText, numberToPacked, numberToZoned, packedToNumber, textToEbcdic, zonedToNumber } from "./ibmi-data.js";
import { importOctoConnection, readOctoSession } from "./octo-session.js";
import { summarizeSystemInfo } from "./tdoms-client.js";
import {
  VIEW_DESCRIPTIONS,
  VIEW_IDS,
  buildAnalyticsView,
  buildDependencyGraphView,
  buildKanbanView,
  buildRecordTableView,
  buildTaskTableView
} from "./views.js";
import { WORKING_CONTEXT_FIELDS, readWorkingContext, updateWorkingContext } from "./working-context.js";

const INTERFACE_LEVEL = "V3R0M0";
const SAVE_PAGE_LINES = 4000;
const TASK_FIELDS = ["applicationCode", "fixNumber", "shortFixDescription", "programmer", "fixStatus", "fixType", "release", "pathCode", "priorityNumeric"];

export function registerExtraTools(server, { store, clientFactory, ops, octo = {} }) {
  const { result, requireConfirmation, compact } = ops;
  const post = (connectionId, service, path, body) => ops.tdomsPost(store, connectionId, service, path, body, clientFactory);
  const readSession = octo.readSession || readOctoSession;

  const connectionId = z.string().describe("Saved connection id. Omit to use the active connection.");
  const confirm = z.boolean().optional().describe("Must be true. This tool changes TD/OMS or local configuration.");
  const optionalText = (description) => z.string().optional().describe(description);

  // --- Working context -----------------------------------------------------

  server.registerTool("tdoms_set_working_context", {
    description: "Save the defaults later calls fall back to: active connection, application, task, request, environment and transfer path. Pass null to clear one value, or clear: true to reset everything. Changes only local settings.",
    inputSchema: {
      activeConnectionId: z.string().nullable().optional().describe("Connection to use when a call names none."),
      applicationCode: z.string().nullable().optional(),
      taskNumber: z.string().nullable().optional(),
      requestNumber: z.string().nullable().optional(),
      environmentCode: z.string().nullable().optional(),
      pathCode: z.string().nullable().optional(),
      clear: z.boolean().optional().describe("Remove every saved default before applying the other values.")
    }
  }, async ({ clear, ...patch }) => {
    if (patch.activeConnectionId) {
      const known = await store.listConnections();
      if (!known.some((connection) => connection.id === patch.activeConnectionId)) {
        throw new Error(`Connection not found: ${patch.activeConnectionId}`);
      }
    }
    const workingContext = await updateWorkingContext(store, patch, { clear: clear === true });
    return result({ ok: true, workingContext, fields: WORKING_CONTEXT_FIELDS });
  });

  // --- Views ---------------------------------------------------------------

  server.registerTool("tdoms_get_view", {
    description: `Return one TD/OMS view as UI-neutral data: a widget (board, table, stats or graph) an app can render, plus a plain-language summary to tell the user. Views: ${VIEW_IDS.map((id) => `${id} (${VIEW_DESCRIPTIONS[id]})`).join(" ")}`,
    inputSchema: {
      connectionId: connectionId.optional(),
      view: z.enum(VIEW_IDS),
      applicationCode: optionalText("Defaults to the working context application."),
      taskNumber: optionalText("Limit build queue rows to one task."),
      programmer: optionalText("Defaults to the signed-in programmer for task views."),
      allUsers: z.boolean().optional().describe("Task views: include every programmer's tasks."),
      status: optionalText("Task views: only this task status."),
      objectCode: optionalText("Object for dependencyGraph, buildQueue or transferHistory."),
      objectType: optionalText("Object type, such as *PGM or *FILE."),
      objectLibrary: optionalText("Object library."),
      memberCode: optionalText("Member or detail. dependencyGraph needs it; repeat the object code when there is no member."),
      pageNumber: z.number().int().min(1).default(1),
      recordsPerPage: z.number().int().min(1).max(50).default(50),
      maxRecords: z.number().int().min(1).max(500).default(200).describe("Task views read pages until this many records are loaded.")
    }
  }, async (input) => {
    const id = await ops.resolveConnectionId(store, input.connectionId);
    const defaults = await readWorkingContext(store);
    const context = compact({
      applicationCode: input.applicationCode || defaults.applicationCode,
      taskNumber: input.taskNumber,
      status: input.status,
      objectCode: input.objectCode,
      objectType: input.objectType,
      objectLibrary: input.objectLibrary,
      memberCode: input.memberCode
    });
    const source = { connectionId: id };

    if (["workManagement", "kanban", "analytics"].includes(input.view)) {
      if (input.allUsers !== true) {
        const connection = await store.getConnection(id);
        context.programmer = String(input.programmer || connection?.username || "").toUpperCase() || undefined;
      }
      const selections = [
        context.applicationCode && { field: "applicationCode", value: context.applicationCode, operator: "EQ" },
        context.programmer && { field: "programmer", value: context.programmer, operator: "EQ" },
        context.status && { field: "fixStatus", value: context.status, operator: "EQ" }
      ].filter(Boolean);
      const { records, total } = await readPages(id, { table: "OMXFix", returnFields: TASK_FIELDS, fieldSelections: selections }, input);
      const build = { workManagement: buildTaskTableView, kanban: buildKanbanView, analytics: buildAnalyticsView }[input.view];
      return result({ ok: true, ...build(records, { context: compact(context), total }), source: { ...source, kind: "OMRDBA/OMXFix" }, generatedAt: new Date().toISOString() });
    }

    if (input.view === "dependencyGraph") {
      const path = ops.buildImpactPath(context);
      if (!path) {
        return result({ ok: false, view: input.view, blockers: ["dependencyGraph needs objectCode, objectType, objectLibrary and memberCode."] });
      }
      const response = await ops.tdomsGet(store, id, "OMQRIA", path, clientFactory);
      return result({ ok: true, ...buildDependencyGraphView(response, { context }), source: { ...source, kind: `OMQRIA${path}` }, generatedAt: new Date().toISOString() });
    }

    const objectSelections = [
      context.applicationCode && { field: "applicationCode", value: context.applicationCode, operator: "EQ" },
      input.view === "buildQueue" && context.taskNumber && { field: "fixNumber", value: context.taskNumber, operator: "EQ" },
      context.objectCode && { field: "objectCode", value: context.objectCode, operator: "EQ" },
      context.objectType && { field: "objectType", value: context.objectType, operator: "EQ" },
      context.memberCode && { field: "memberCode", value: context.memberCode, operator: "EQ" }
    ].filter(Boolean);
    const spec = input.view === "buildQueue"
      ? { table: "OMXCreateObjectMonitorExtended", title: "Build Queue", noun: "build queue row", statusField: "processingStatus", fields: [["objectCode", "Object"], ["objectType", "Type"], ["memberCode", "Member"], ["processingStatus", "Status"], ["createStatus", "Create status"], ["job", "Job"], ["fixNumber", "Task"], ["environmentCode", "Environment"]] }
      : { table: "OMXObjectTransferHistory", title: "Transfer History", noun: "transfer", statusField: "errorIndicator", statusFallback: "ok", fields: [["transferCode", "Transfer"], ["objectCode", "Object"], ["objectType", "Type"], ["memberCode", "Member"], ["versionNumber", "Version"], ["fromEnvironment", "From"], ["toEnvironment", "To"], ["systemDate", "Date"], ["errorIndicator", "Error"], ["job", "Job"]] };
    const response = await ops.queryDatabase(store, id, {
      table: spec.table,
      fieldSelections: objectSelections,
      pageNumber: input.pageNumber ?? 1,
      recordsPerPage: input.recordsPerPage ?? 50,
      returnTotalRecords: true
    }, clientFactory);
    return result({
      ok: true,
      ...buildRecordTableView(input.view, spec.title, ops.extractRecords(response).map(withJob), { context, total: totalOf(response), fields: spec.fields, noun: spec.noun, statusField: spec.statusField, statusFallback: spec.statusFallback }),
      source: { ...source, kind: `OMRDBA/${spec.table}` },
      generatedAt: new Date().toISOString()
    });
  });

  // TD/OMS returns the job as separate number and name fields.
  function withJob(record) {
    const job = [record?.jobNumber, record?.jobName].map((part) => String(part ?? "").trim()).filter(Boolean).join("/");
    return { ...record, job };
  }

  async function readPages(id, query, input) {
    const perPage = input.recordsPerPage ?? 50;
    const limit = input.maxRecords ?? 200;
    const records = [];
    let total;
    for (let page = input.pageNumber ?? 1; records.length < limit; page += 1) {
      const response = await ops.queryDatabase(store, id, { ...query, pageNumber: page, recordsPerPage: perPage, returnTotalRecords: true }, clientFactory);
      const rows = ops.extractRecords(response);
      total = totalOf(response) ?? total;
      records.push(...rows);
      if (rows.length < perPage || (Number.isFinite(total) && records.length >= total)) break;
    }
    return { records: records.slice(0, limit), total };
  }

  // --- Connections and sign-in ----------------------------------------------

  server.registerTool("tdoms_user_context", {
    description: "Who is signed in: TD/OMS username, programmer id, email when known, manager flags, and the role held in each application.",
    inputSchema: { connectionId }
  }, async (input) => {
    const connection = await store.getConnection(input.connectionId);
    if (!connection) throw new Error(`Connection not found: ${input.connectionId}`);
    const system = summarizeSystemInfo(await ops.tdomsGet(store, input.connectionId, "OMSINFO", "/system", clientFactory));
    return result({
      ok: true,
      user: {
        tdomsUsername: connection.username,
        programmerId: String(connection.username || "").toUpperCase(),
        email: connection.email,
        isOMSManager: system.isOMSManager,
        isSecurityManager: system.isSecurityManager,
        isExitManager: system.isExitManager
      },
      applications: system.applications.map((application) => ({
        applicationCode: application.applicationCode,
        applicationName: application.applicationName,
        roles: [application.isManager && "manager", application.isProgrammer && "programmer", application.isUser && "user"].filter(Boolean),
        canCreateTasks: application.canCreateTasks,
        canCreateRequests: application.canCreateRequests
      })),
      workingContext: await readWorkingContext(store)
    });
  });

  server.registerTool("tdoms_connection_octo_status", {
    description: "Check whether the Octo extension has a signed-in TD/OMS session on this machine that can be imported. Returns the server address and token expiry, never the token.",
    inputSchema: {}
  }, async () => {
    const session = await readSession();
    if (!session.found) return result({ ok: true, found: false, reason: session.reason });
    const { accessToken, ...safe } = session;
    return result({ ok: true, ...safe, hasToken: Boolean(accessToken) });
  });

  server.registerTool("tdoms_connection_import_octo", {
    description: "Create or update a saved connection from the Octo extension's signed-in session on this machine, so no second setup is needed. Reuses the Octo token while it is valid. Requires confirm: true.",
    inputSchema: {
      username: optionalText("TD/OMS username, when the Octo session does not reveal it."),
      name: optionalText("Display name for the saved connection."),
      reuseToken: z.boolean().default(true).describe("Save the Octo token for this connection."),
      makeActive: z.boolean().default(true).describe("Use this connection when a call names none."),
      confirm
    }
  }, async (input) => {
    requireConfirmation(input.confirm, "import the Octo session as a saved connection");
    const imported = await importOctoConnection(store, {
      session: await readSession(),
      reuseToken: input.reuseToken !== false,
      username: input.username,
      name: input.name
    });
    if (imported.imported && input.makeActive !== false) {
      await updateWorkingContext(store, { activeConnectionId: imported.connection.id });
    }
    return result(imported);
  });

  // --- Source: check and safe save ------------------------------------------

  const sourceTarget = {
    connectionId,
    applicationCode: optionalText("Application code. Supply with taskNumber for source connected to a task."),
    taskNumber: optionalText("Task number. Required to save."),
    path: optionalText("Absolute IBM i IFS path. Do not combine with object fields."),
    objectCode: optionalText("Object or source file, such as QRPGLESRC."),
    objectType: optionalText("Object type. Use *FILE for a source member."),
    objectLibrary: optionalText("Object or source library."),
    memberCode: optionalText("Source member.")
  };

  server.registerTool("tdoms_check_source", {
    description: "Read source metadata only (canEdit, ccsid, sourceType, lastChangeDate, numberOfPages) without downloading any source. Use it before reading large source or before saving.",
    inputSchema: sourceTarget
  }, async (input) => {
    assertSourceTarget(input);
    const metadata = await ops.readSourcePage(store, input.connectionId, input, 0, clientFactory);
    return result({ ok: true, metadata: sourceMetadata(metadata) });
  });

  server.registerTool("tdoms_save_source_checked", {
    description: "Save complete source text safely. Re-reads metadata first and refuses when the target is not editable or changed since expectedLastChangeDate. Uploads in pages of up to 4,000 lines and, on failure, reports the failed page and how many pages were acknowledged. forceSave: true skips the change check and may overwrite other edits. Requires confirm: true.",
    inputSchema: {
      ...sourceTarget,
      sourceText: z.string().describe("Complete source text to save."),
      expectedLastChangeDate: optionalText("lastChangeDate from your last read or check. The save is refused when the target changed after it."),
      forceSave: z.boolean().default(false),
      confirm
    }
  }, async (input) => {
    requireConfirmation(input.confirm, "save TD/OMS source");
    assertSourceTarget(input);
    if (!input.applicationCode || !input.taskNumber) {
      throw new Error("Saving source needs applicationCode and taskNumber for the development task.");
    }
    const before = sourceMetadata(await ops.readSourcePage(store, input.connectionId, input, 0, clientFactory));
    const force = input.forceSave === true;
    if (before.canEdit === false && !force) {
      return result({ ok: false, saved: false, reason: "TD/OMS reports this source is not editable for the task.", metadata: before });
    }
    if (!force && input.expectedLastChangeDate && before.lastChangeDate && input.expectedLastChangeDate !== before.lastChangeDate) {
      return result({
        ok: false,
        saved: false,
        reason: "The source changed after it was last read. Read it again and reapply the edit, or pass forceSave: true to overwrite.",
        expectedLastChangeDate: input.expectedLastChangeDate,
        metadata: before
      });
    }

    const pages = splitLines(input.sourceText, SAVE_PAGE_LINES);
    let acknowledgedPages = 0;
    for (const [index, pageText] of pages.entries()) {
      try {
        const response = await post(input.connectionId, "OMRSRC", "/object/save", compact({
          applicationCode: input.applicationCode,
          taskNumber: input.taskNumber,
          path: input.path,
          objectCode: input.objectCode,
          objectType: input.objectType,
          objectLibrary: input.objectLibrary,
          memberCode: input.memberCode,
          pageNumber: index + 1,
          numberOfPages: pages.length,
          sourceCode: Buffer.from(pageText, "utf8").toString("base64"),
          ccsid: before.ccsid,
          lastChangeDate: before.lastChangeDate,
          forceSave: force
        }));
        const failure = ops.tdomsFailure(response);
        if (failure) throw new Error(failure);
        acknowledgedPages += 1;
      } catch (error) {
        return result({
          ok: false,
          saved: false,
          failedPage: index + 1,
          acknowledgedPages,
          numberOfPages: pages.length,
          reason: String(error?.message || error),
          next: "A failed request does not confirm a save. Run tdoms_check_source before retrying."
        });
      }
    }
    const after = sourceMetadata(await ops.readSourcePage(store, input.connectionId, input, 0, clientFactory).catch(() => undefined));
    return result({
      ok: true,
      saved: true,
      numberOfPages: pages.length,
      acknowledgedPages,
      savedBytes: Buffer.byteLength(input.sourceText, "utf8"),
      metadataBefore: before,
      metadata: after
    });
  });

  // --- Objects: templates, data areas, IFS objects ---------------------------

  const templateData = {
    category: z.string().describe("Template category."),
    description: z.string().describe("Template description. Category and description identify the template."),
    objectType: optionalText("Object type, such as *PGM."),
    objectAttribute: optionalText("Object attribute, such as RPGLE."),
    mayNotExistIndicator: optionalText("TD/OMS may-not-exist indicator."),
    sourceFile: optionalText("Source file."),
    objectCode: optionalText("Object code or naming pattern."),
    memberAttributeMbseu: optionalText("Source member attribute."),
    relatedObjectCode: optionalText("Template object to copy from."),
    relatedObjectType: optionalText("Template object type."),
    relatedObjectLibrary: optionalText("Template object library."),
    relatedMemberCode: optionalText("Template member."),
    regularExpression1: optionalText("First naming rule."),
    messageText1: optionalText("Message shown when the first rule fails."),
    regularExpression2: optionalText("Second naming rule."),
    messageText: optionalText("Message shown when the second rule fails."),
    labelCode1: optionalText("Label applied to new objects."),
    labelCode2: optionalText("Label applied to new objects."),
    labelCode3: optionalText("Label applied to new objects."),
    labelCode4: optionalText("Label applied to new objects."),
    labelCode5: optionalText("Label applied to new objects.")
  };
  const processingOptions = z.record(z.string(), z.string()).optional().describe("Overrides for the processing options. Defaults: updateDb 1, updateBuffer 1. Site-specific templateType and basedObjectInd go here.");
  const renameFields = {
    newCategory: optionalText("New category."),
    newDescription: optionalText("New description.")
  };

  for (const [action, verb, extra] of [
    ["add", "Create", {}],
    ["change", "Change", renameFields],
    ["copy", "Copy", renameFields],
    ["delete", "Delete", {}]
  ]) {
    const fields = action === "delete" ? { category: templateData.category, description: templateData.description } : { ...templateData, ...extra };
    server.registerTool(`tdoms_object_template_${action}`, {
      description: `${verb} a new-object template through OMQROT/${action}. Discover existing templates with the objectTemplates option set. Requires confirm: true.`,
      inputSchema: { connectionId, ...fields, processingOptions, confirm }
    }, async ({ connectionId: id, confirm: confirmed, processingOptions: overrides, ...data }) => {
      requireConfirmation(confirmed, `${action} a TD/OMS object template`);
      const body = {
        interfaceLevel: INTERFACE_LEVEL,
        [`${action}ProcessingOptions`]: { updateDb: "1", updateBuffer: "1", ...(overrides || {}) },
        [`${action}TemplateData`]: compact(data)
      };
      const response = await post(id, "OMQROT", `/${action}`, body);
      return result({ ok: !ops.tdomsFailure(response), response, body });
    });
  }

  server.registerTool("tdoms_data_area_create", {
    description: "Create a data area under a task through OMQRNO/addDataArea. Requires confirm: true.",
    inputSchema: {
      connectionId,
      applicationCode: z.string(),
      taskNumber: z.string(),
      environment: z.string().describe("Environment code, such as the development environment."),
      dataArea: z.string().describe("Data area name."),
      library: z.string().describe("Library for the data area."),
      type: z.string().describe("Data area type, such as *CHAR, *DEC or *LGL."),
      length: z.union([z.string(), z.number()]).optional(),
      decimalPosition: z.union([z.string(), z.number()]).optional(),
      initialValue: z.string().optional(),
      description: z.string().optional(),
      confirm
    }
  }, async ({ connectionId: id, confirm: confirmed, ...body }) => {
    requireConfirmation(confirmed, "create a TD/OMS data area");
    const response = await post(id, "OMQRNO", "/addDataArea", compact(body));
    return result({ ok: !ops.tdomsFailure(response), response, body: compact(body) });
  });

  server.registerTool("tdoms_ifs_object_create", {
    description: "Create an IFS object under a task through OMQRNO/addIFSObject. Requires confirm: true.",
    inputSchema: {
      connectionId,
      application: z.string().describe("Application code."),
      taskNumber: z.string(),
      environment: z.string().describe("Environment code."),
      routeCode: z.string().describe("IFS route code."),
      ifsFileName: z.string().describe("New IFS file name."),
      subDirectory: z.string().optional().describe("Directory below the route."),
      subEnvironmentSequence: z.union([z.string(), z.number()]).optional(),
      templateDirectory: z.string().optional().describe("Directory of a template file to copy."),
      templateFile: z.string().optional().describe("Template file to copy."),
      confirm
    }
  }, async ({ connectionId: id, confirm: confirmed, ...body }) => {
    requireConfirmation(confirmed, "create a TD/OMS IFS object");
    const response = await post(id, "OMQRNO", "/addIFSObject", compact(body));
    return result({ ok: !ops.tdomsFailure(response), response, body: compact(body) });
  });

  // --- IBM i data conversions ------------------------------------------------

  server.registerTool("tdoms_ibmi_convert", {
    description: "Convert IBM i data locally: EBCDIC (CCSID 37) text, packed decimal and zoned decimal. Bytes are hexadecimal strings. Nothing is sent to TD/OMS.",
    inputSchema: {
      operation: z.enum(["ebcdicToText", "textToEbcdic", "packedToNumber", "numberToPacked", "zonedToNumber", "numberToZoned"]),
      value: z.string().describe("Hex bytes for the *To* text/number operations; text or a decimal number otherwise."),
      precision: z.number().int().min(1).max(63).optional().describe("Total digits. Required for numberToPacked and numberToZoned."),
      scale: z.number().int().min(0).max(63).default(0).describe("Decimal places.")
    }
  }, async ({ operation, value, precision, scale = 0 }) => {
    const convert = {
      ebcdicToText: () => ebcdicToText(value),
      textToEbcdic: () => textToEbcdic(value),
      packedToNumber: () => packedToNumber(value, scale),
      numberToPacked: () => numberToPacked(value, precision, scale),
      zonedToNumber: () => zonedToNumber(value, scale),
      numberToZoned: () => numberToZoned(value, precision, scale)
    }[operation];
    return result({ ok: true, operation, result: convert() });
  });
}

function assertSourceTarget(input) {
  const objectFields = ["objectCode", "objectType", "objectLibrary", "memberCode"].filter((field) => input[field]);
  if (input.path && objectFields.length > 0) {
    throw new Error("Use either an IFS path or object fields, not both.");
  }
  if (!input.path) {
    const missing = ["objectCode", "objectType", "objectLibrary"].filter((field) => !input[field]);
    if (missing.length > 0) throw new Error(`Missing source target: ${missing.join(", ")} (or an IFS path).`);
  }
}

function sourceMetadata(response) {
  if (!response || typeof response !== "object") return {};
  return {
    canEdit: response.canEdit,
    ccsid: response.ccsid,
    sourceType: response.sourceType,
    lastChangeDate: response.lastChangeDate,
    numberOfPages: response.numberOfPages,
    maximumLineLength: response.maximumLineLength
  };
}

// Splits on line boundaries and keeps each line's own ending, so joining the
// pages reproduces the text exactly.
export function splitLines(text, linesPerPage) {
  const lines = String(text ?? "").match(/[^\n]*\n|[^\n]+$/g) || [""];
  const pages = [];
  for (let index = 0; index < lines.length; index += linesPerPage) {
    pages.push(lines.slice(index, index + linesPerPage).join(""));
  }
  return pages;
}

function totalOf(response) {
  for (const candidate of [response?.totalNumberOfRecords, response?.totalRecords, response?.listOutput?.totalNumberOfRecords, response?.listOutput?.totalRecords]) {
    const value = Number(candidate);
    if (candidate !== undefined && candidate !== null && candidate !== "" && Number.isFinite(value)) return value;
  }
  return undefined;
}
