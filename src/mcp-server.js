import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CAPABILITIES, CAPABILITY_IDS, OPTION_SETS, getCapability } from "./capability-registry.js";
import { ConnectionStore } from "./connection-store.js";
import { TdomsClient, summarizeSystemInfo } from "./tdoms-client.js";

const INSTRUCTIONS = [
  "TD/OMS MCP connects agents to locally configured TD/OMS REST profiles.",
  "Use tdoms_get_current_context first; it automatically selects the only saved connection and derives the TD/OMS programmer identity.",
  "Use tdoms_discover_options before choosing site-specific TD/OMS values, then plan and execute mutations through the workflow tools.",
  "Never ask the user to paste credentials into agent chat; credentials should be saved through the localhost UI.",
  "Tools that create, save, queue, release, process, or delete require confirm: true."
].join(" ");

const fieldSelectionSchema = z.object({
  field: z.string().optional().describe("Normalized TD/OMS field name, such as applicationCode or fixNumber."),
  value: z.string().optional().describe("Comparison value."),
  operator: z.enum([
    "IN",
    "NOTIN",
    "BETWEEN",
    "NOTBETWEEN",
    "REGEX",
    "EQ",
    "LT",
    "GT",
    "LE",
    "GE",
    "NE",
    "STARTSWITH",
    "ENDSWITH",
    "CONTAINS",
    "NOTSTARTSWITH",
    "NOTENDSWITH",
    "NOTCONTAINS",
    "AND",
    "OR"
  ]).default("IN"),
  group: z.number().optional(),
  parentGroup: z.number().optional(),
  ignoreCase: z.boolean().optional()
});

const sortFieldSchema = z.object({
  fieldName: z.string(),
  sortBy: z.enum(["ASC", "DESC"]).default("ASC")
});

const sourceObjectSchema = {
  applicationCode: z.string().optional().describe("TD/OMS application code. Required when reading source connected to a task."),
  taskNumber: z.string().optional().describe("TD/OMS task/fix number. Required when reading source connected to a task."),
  path: z.string().optional().describe("Optional IFS path for IFS source."),
  objectCode: z.string().optional().describe("Object or source file code, such as QRPGLESRC."),
  objectType: z.string().optional().describe("Object type, such as *PGM, *FILE, *MODULE, or *SRVPGM."),
  objectLibrary: z.string().optional().describe("Object/source library."),
  memberCode: z.string().optional().describe("Member/detail name. Use *NONE when there is no member."),
  pageNumber: z.number().int().min(0).default(1).describe("Use 0 to fetch metadata without source.")
};

const buildObjectSchema = {
  applicationCode: z.string().describe("TD/OMS application code."),
  taskNumber: z.string().describe("TD/OMS task/fix number."),
  objectCode: z.string().optional().describe("Object code. Leave blank to operate on the whole task."),
  objectType: z.string().optional().describe("Object type, such as *PGM, *FILE, *MODULE, or *SRVPGM."),
  objectLibrary: z.string().optional().describe("Object library."),
  detail: z.string().optional().describe("Detail/member, if any.")
};

export function createMcpServer({
  store = new ConnectionStore(),
  clientFactory = (connection) => new TdomsClient(connection),
  profile = process.env.TDOMS_MCP_PROFILE || "core",
  clock = () => Date.now()
} = {}) {
  const normalizedProfile = normalizeProfile(profile);
  const workflowPlans = new Map();
  const server = new McpServer(
    {
      name: "tdoms-mcp",
      version: "0.3.0"
    },
    {
      instructions: INSTRUCTIONS
    }
  );

  server.registerTool(
    "tdoms_list_connections",
    {
      description: "List locally saved TD/OMS connection profiles without returning secrets.",
      inputSchema: {}
    },
    async () => {
      const connections = await store.listConnections();
      return result({ connections });
    }
  );

  registerAgentTools(server, { store, clientFactory, workflowPlans, clock, profile: normalizedProfile });

  if (normalizedProfile === "core") {
    return server;
  }

  server.registerTool(
    "tdoms_call_api",
    {
      description: "Call a documented TD/OMS REST endpoint directly. Requires confirm: true because most TD/OMS APIs are POST and may mutate state.",
      inputSchema: {
        connectionId: z.string(),
        service: z.string().describe("TD/OMS service code, such as OMQRTA, OMQRTO, OMQRSO, OMQRSF, OMQROB, or OMRRQS."),
        path: z.string().describe("Endpoint path, such as /change, /select, /list, or /progress."),
        body: z.record(z.string(), z.unknown()).default({}),
        confirm: z.boolean().describe("Must be true to call a generic TD/OMS endpoint.")
      }
    },
    async (input) => {
      requireConfirmation(input.confirm, `call TD/OMS ${input.service}${input.path}`);
      const response = await tdomsPost(store, input.connectionId, input.service, input.path, input.body, clientFactory);
      return result({ ok: true, response });
    }
  );

  server.registerTool(
    "tdoms_login_connection",
    {
      description: "Login to a saved TD/OMS connection using locally stored credentials, save the JWT, and probe OMSINFO/system.",
      inputSchema: {
        connectionId: z.string().describe("Saved TD/OMS connection id from tdoms_list_connections.")
      }
    },
    async ({ connectionId }) => {
      const { connection, client, token } = await loginAndSave(store, connectionId, clientFactory);
      const systemInfo = await client.getSystemInfo(token);
      await store.updateStatus(connection.id, {
        lastStatus: "system-probe-ok",
        lastSystemProbeAt: new Date().toISOString()
      });

      return result({
        ok: true,
        connection: await store.getConnection(connection.id),
        system: summarizeSystemInfo(systemInfo)
      });
    }
  );

  server.registerTool(
    "tdoms_get_system_info",
    {
      description: "Fetch TD/OMS OMSINFO/system for a saved connection. Automatically logs in again if needed.",
      inputSchema: {
        connectionId: z.string().describe("Saved TD/OMS connection id from tdoms_list_connections."),
        applications: z.string().optional().describe("Optional comma-separated application codes to load.")
      }
    },
    async ({ connectionId, applications }) => {
      const suffix = applications ? `/system?applications=${encodeURIComponent(applications)}` : "/system";
      const systemInfo = await tdomsGet(store, connectionId, "OMSINFO", suffix, clientFactory);
      await store.updateStatus(connectionId, {
        lastStatus: "system-probe-ok",
        lastSystemProbeAt: new Date().toISOString()
      });

      return result({
        ok: true,
        system: summarizeSystemInfo(systemInfo),
        raw: systemInfo
      });
    }
  );

  server.registerTool(
    "tdoms_query_database",
    {
      description: "Read TD/OMS table data through OMRDBA/get. Use for discovery when a specific higher-level tool is not enough.",
      inputSchema: {
        connectionId: z.string(),
        table: z.string().describe("TD/OMS table or view name, such as OMXFix."),
        returnFields: z.array(z.string()).optional().describe("Normalized field names to return. Leave empty for all fields."),
        fieldSelections: z.array(fieldSelectionSchema).optional(),
        whereClause: z.string().optional(),
        sortFields: z.array(sortFieldSchema).optional(),
        pageNumber: z.number().int().min(1).default(1),
        recordsPerPage: z.number().int().min(1).max(50).default(25),
        returnTotalRecords: z.boolean().default(true),
        distinct: z.boolean().optional(),
        schemaOverride: z.string().optional()
      }
    },
    async (input) => {
      const response = await queryDatabase(store, input.connectionId, {
        table: input.table,
        returnFields: input.returnFields,
        fieldSelections: input.fieldSelections,
        whereClause: input.whereClause,
        sortFields: input.sortFields,
        pageNumber: input.pageNumber,
        recordsPerPage: input.recordsPerPage,
        returnTotalRecords: input.returnTotalRecords,
        distinct: input.distinct,
        schemaOverride: input.schemaOverride
      }, clientFactory);
      return result({ ok: true, response });
    }
  );

  server.registerTool(
    "tdoms_search_tasks",
    {
      description: "Search TD/OMS tasks/fixes using the OMRDBA OMXFix table.",
      inputSchema: {
        connectionId: z.string(),
        applicationCode: z.string().optional(),
        taskNumber: z.string().optional().describe("Task/fix number."),
        programmer: z.string().optional(),
        status: z.string().optional().describe("TD/OMS fix status, if known."),
        text: z.string().optional().describe("Text to search in the short task description."),
        pageNumber: z.number().int().min(1).default(1),
        recordsPerPage: z.number().int().min(1).max(50).default(25)
      }
    },
    async (input) => {
      const fieldSelections = compactArray([
        input.applicationCode && { field: "applicationCode", value: input.applicationCode, operator: "EQ" },
        input.taskNumber && { field: "fixNumber", value: input.taskNumber, operator: "EQ" },
        input.programmer && { field: "programmer", value: input.programmer, operator: "EQ" },
        input.status && { field: "fixStatus", value: input.status, operator: "EQ" },
        input.text && { field: "shortFixDescription", value: input.text, operator: "CONTAINS", ignoreCase: true }
      ]);

      const response = await queryDatabase(store, input.connectionId, {
        table: "OMXFix",
        returnFields: [
          "applicationCode",
          "fixNumber",
          "shortFixDescription",
          "programmer",
          "fixStatus",
          "release",
          "pathCode",
          "expectedStartDate",
          "expectedCompletionDate"
        ],
        fieldSelections,
        sortFields: [
          { fieldName: "applicationCode", sortBy: "ASC" },
          { fieldName: "fixNumber", sortBy: "DESC" }
        ],
        pageNumber: input.pageNumber ?? 1,
        recordsPerPage: input.recordsPerPage ?? 25,
        returnTotalRecords: true
      }, clientFactory);

      return result({ ok: true, response });
    }
  );

  server.registerTool(
    "tdoms_get_task",
    {
      description: "Fetch one TD/OMS task/fix from OMXFix by applicationCode and taskNumber.",
      inputSchema: {
        connectionId: z.string(),
        applicationCode: z.string(),
        taskNumber: z.string()
      }
    },
    async ({ connectionId, applicationCode, taskNumber }) => {
      const response = await queryDatabase(store, connectionId, {
        table: "OMXFix",
        fieldSelections: [
          { field: "applicationCode", value: applicationCode, operator: "EQ" },
          { field: "fixNumber", value: taskNumber, operator: "EQ" }
        ],
        pageNumber: 1,
        recordsPerPage: 1,
        returnTotalRecords: true
      }, clientFactory);
      return result({ ok: true, response });
    }
  );

  server.registerTool(
    "tdoms_create_task",
    {
      description: "Create a TD/OMS task/fix through OMQRTA/add. Requires confirm: true.",
      inputSchema: {
        connectionId: z.string(),
        applicationCode: z.string().max(5),
        shortDescription: z.string().max(50),
        longDescription: z.string().optional(),
        programmer: z.string().optional().describe("Defaults to *CURRENT."),
        release: z.enum(["*SAME", "*CURRENT"]).default("*SAME"),
        priorityNumeric: z.enum(["*SAME", "*DFT"]).default("*SAME"),
        pathCode: z.enum(["*SAME", "*DFT"]).default("*SAME"),
        sendMessageToProgrammer: z.boolean().default(true),
        confirm: z.boolean().describe("Must be true to create a task.")
      }
    },
    async (input) => {
      requireConfirmation(input.confirm, "create TD/OMS task");
      const body = compact({
        interfaceLevel: "V3R0M0",
        addProcessingOptions: {
          sendMessageToProgrammer: input.sendMessageToProgrammer ? "1" : "0",
          updateDb: "1",
          updateBuffer: "1"
        },
        addData: {
          applicationCode: input.applicationCode,
          fixNumber: "*GEN",
          release: input.release,
          priorityNumeric: input.priorityNumeric,
          programmer: input.programmer || "*CURRENT",
          shortFixDescription: input.shortDescription,
          longDescription: input.longDescription,
          pathCode: input.pathCode
        }
      });
      const response = await tdomsPost(store, input.connectionId, "OMQRTA", "/add", body, clientFactory);
      return result({ ok: true, response });
    }
  );

  registerActionTool(server, {
    name: "tdoms_task_action",
    description: "Run TD/OMS task lifecycle actions through OMQRTA, including change, status, complete, copy, delete, ratify, and link/unlink request or ticket. Requires confirm: true.",
    service: "OMQRTA",
    actions: ["/change", "/complete", "/link/request", "/unlink/request", "/copy", "/delete", "/ratify", "/status", "/link/ticket", "/unlink/ticket"],
    store,
    clientFactory,
    confirm: true
  });

  registerActionTool(server, {
    name: "tdoms_request_action",
    description: "Run TD/OMS request lifecycle actions through OMRRQS, including add, change, connect, disconnect, status, complete, ratify, rename, copy, and delete. Requires confirm: true.",
    service: "OMQRRE",
    actions: ["/add", "/change", "/connect", "/delete", "/complete", "/disconnect", "/ratify", "/rename", "/status", "/copy"],
    store,
    clientFactory,
    confirm: true
  });

  server.registerTool(
    "tdoms_read_source",
    {
      description: "Read source/member text through OMRSRC/object/get. Returns base64 and a best-effort UTF-8 decode.",
      inputSchema: {
        connectionId: z.string(),
        ...sourceObjectSchema
      }
    },
    async (input) => {
      const response = await tdomsPost(store, input.connectionId, "OMRSRC", "/object/get", compact({
        applicationCode: input.applicationCode,
        taskNumber: input.taskNumber,
        path: input.path,
        objectCode: input.objectCode,
        objectType: input.objectType,
        objectLibrary: input.objectLibrary,
        memberCode: input.memberCode,
        pageNumber: input.pageNumber
      }), clientFactory);
      return result({
        ok: true,
        response,
        sourceTextUtf8: decodeBase64Text(response?.sourceCode),
        sourceCodeBase64: response?.sourceCode
      });
    }
  );

  server.registerTool(
    "tdoms_read_source_all",
    {
      description: "Read all pages of a TD/OMS source/member through OMRSRC/object/get and return decoded text plus save metadata. Use this before editing large source so agents do not have to manually page base64 payloads.",
      inputSchema: {
        connectionId: z.string(),
        ...sourceObjectSchema
      }
    },
    async (input) => {
      const read = await readAllSourcePages(store, input.connectionId, input, clientFactory);
      return result({ ok: true, ...read });
    }
  );

  server.registerTool(
    "tdoms_save_source",
    {
      description: "Save source through OMRSRC/object/save. Pass lastChangeDate from tdoms_read_source. Requires confirm: true.",
      inputSchema: {
        connectionId: z.string(),
        ...sourceObjectSchema,
        sourceText: z.string().optional().describe("Plain source text to encode as base64."),
        sourceCodeBase64: z.string().optional().describe("Already encoded sourceCode value."),
        ccsid: z.number().int().optional(),
        numberOfPages: z.number().int().min(1).default(1),
        lastChangeDate: z.string().describe("lastChangeDate returned by tdoms_read_source."),
        forceSave: z.boolean().default(false),
        confirm: z.boolean().describe("Must be true to save source.")
      }
    },
    async (input) => {
      requireConfirmation(input.confirm, "save TD/OMS source");
      if (input.sourceText === undefined && input.sourceCodeBase64 === undefined) {
        throw new Error("Provide either sourceText or sourceCodeBase64.");
      }

      const sourceCode = input.sourceCodeBase64 ?? Buffer.from(input.sourceText, "utf8").toString("base64");
      const response = await tdomsPost(store, input.connectionId, "OMRSRC", "/object/save", compact({
        applicationCode: input.applicationCode,
        taskNumber: input.taskNumber,
        path: input.path,
        objectCode: input.objectCode,
        objectType: input.objectType,
        objectLibrary: input.objectLibrary,
        memberCode: input.memberCode,
        pageNumber: input.pageNumber,
        numberOfPages: input.numberOfPages,
        sourceCode,
        ccsid: input.ccsid,
        lastChangeDate: input.lastChangeDate,
        forceSave: input.forceSave
      }), clientFactory);
      return result({ ok: true, response });
    }
  );

  server.registerTool(
    "tdoms_save_source_all",
    {
      description: "Save complete plain source text through OMRSRC/object/save, chunking into pages automatically. Pass lastChangeDate from tdoms_read_source_all. Requires confirm: true.",
      inputSchema: {
        connectionId: z.string(),
        ...sourceObjectSchema,
        sourceText: z.string().describe("Complete plain source text to save."),
        ccsid: z.number().int().optional(),
        lastChangeDate: z.string().describe("lastChangeDate returned by tdoms_read_source_all or tdoms_read_source."),
        forceSave: z.boolean().default(false),
        maxPageBytes: z.number().int().min(1000).max(48000).default(48000).describe("Maximum UTF-8 bytes per saved page. Default stays below OMRSRC sourceCode limits."),
        confirm: z.boolean().describe("Must be true to save source.")
      }
    },
    async (input) => {
      requireConfirmation(input.confirm, "save complete TD/OMS source");
      const save = await saveAllSourcePages(store, input.connectionId, input, clientFactory);
      return result({ ok: true, ...save });
    }
  );

  server.registerTool(
    "tdoms_patch_source_literal",
    {
      description: "Read a complete TD/OMS source member, perform a literal text replacement, and save it back with optimistic lastChangeDate checking. Requires confirm: true.",
      inputSchema: {
        connectionId: z.string(),
        ...sourceObjectSchema,
        searchText: z.string().describe("Exact text to replace in the decoded source."),
        replacementText: z.string().describe("Replacement text."),
        occurrence: z.number().int().min(1).default(1).describe("Which occurrence to replace when replaceAll is false."),
        replaceAll: z.boolean().default(false),
        forceSave: z.boolean().default(false),
        confirm: z.boolean().describe("Must be true to patch source.")
      }
    },
    async (input) => {
      requireConfirmation(input.confirm, "patch TD/OMS source");
      const read = await readAllSourcePages(store, input.connectionId, input, clientFactory);
      if (read.canEdit === false && !input.forceSave) {
        throw new Error("TD/OMS reports canEdit:false. Refusing to save unless forceSave:true is explicitly set.");
      }
      const patch = replaceLiteral(read.sourceTextUtf8, input.searchText, input.replacementText, {
        occurrence: input.occurrence,
        replaceAll: input.replaceAll
      });
      const save = await saveAllSourcePages(store, input.connectionId, {
        ...input,
        sourceText: patch.text,
        ccsid: read.ccsid,
        lastChangeDate: read.lastChangeDate,
        forceSave: input.forceSave
      }, clientFactory);
      return result({
        ok: true,
        replacements: patch.replacements,
        beforeLength: read.sourceTextUtf8.length,
        afterLength: patch.text.length,
        read: {
          numberOfPages: read.numberOfPages,
          lastChangeDate: read.lastChangeDate,
          ccsid: read.ccsid,
          canEdit: read.canEdit
        },
        save
      });
    }
  );

  server.registerTool(
    "tdoms_connection_list_add",
    {
      description: "Add an object/member to a TD/OMS connection list through OMQRCL/add. Requires confirm: true.",
      inputSchema: {
        connectionId: z.string(),
        applicationCode: z.string(),
        connectionListCode: z.string().default("*USER"),
        taskNumber: z.string().describe("Task/fix number."),
        objectCode: z.string(),
        objectLibrary: z.string(),
        objectType: z.string(),
        memberCode: z.string().default("*NONE"),
        ifsObject: z.string().default("*OBJC"),
        solutionType: z.enum(["*CHANGE", "*COMPILE", "*TERMINATE"]).default("*CHANGE"),
        connectWithRules: z.boolean().default(false),
        applicationRelation: z.boolean().default(false),
        confirm: z.boolean().describe("Must be true to add to a connection list.")
      }
    },
    async (input) => {
      requireConfirmation(input.confirm, "add TD/OMS connection-list entry");
      const response = await tdomsPost(store, input.connectionId, "OMQRCL", "/add", {
        addProcessingOption: {
          connectWithRules: input.connectWithRules ? "1" : "0",
          applicationRelation: input.applicationRelation ? "1" : "0"
        },
        addData: {
          applicationCode: input.applicationCode,
          connectionListCode: input.connectionListCode,
          taskNumber: input.taskNumber,
          objectCode: input.objectCode,
          objectLibrary: input.objectLibrary,
          objectType: input.objectType,
          memberCode: input.memberCode,
          ifsObject: input.ifsObject,
          solutionType: input.solutionType
        }
      }, clientFactory);
      return result({ ok: true, response });
    }
  );

  server.registerTool(
    "tdoms_connection_list_process",
    {
      description: "Process/connect entries from a TD/OMS connection list through OMQRCL/process. Requires confirm: true.",
      inputSchema: {
        connectionId: z.string(),
        applicationCode: z.string(),
        connectionListCode: z.string().default("*USER"),
        taskNumber: z.string().describe("Task/fix number."),
        objectCode: z.string().default("*ALL"),
        objectLibrary: z.string().optional(),
        objectType: z.string().optional(),
        memberCode: z.string().default("*NONE"),
        ifsObject: z.string().default("*OBJC"),
        promptOnConflicts: z.boolean().default(false),
        forced: z.boolean().default(false),
        confirm: z.boolean().describe("Must be true to process a connection list.")
      }
    },
    async (input) => {
      requireConfirmation(input.confirm, "process TD/OMS connection list");
      const response = await tdomsPost(store, input.connectionId, "OMQRCL", "/process", compact({
        processProcessingOption: {
          promptOnConflicts: input.promptOnConflicts ? "1" : "0",
          forced: input.forced ? "1" : "0"
        },
        processData: {
          applicationCode: input.applicationCode,
          connectionListCode: input.connectionListCode,
          taskNumber: input.taskNumber,
          objectCode: input.objectCode,
          objectLibrary: input.objectLibrary,
          objectType: input.objectType,
          memberCode: input.memberCode,
          ifsObject: input.ifsObject
        }
      }), clientFactory);
      return result({ ok: true, response });
    }
  );

  server.registerTool(
    "tdoms_compile_queue_add",
    {
      description: "Queue one object or a whole task for compile through OMQRSQ/queue. Requires confirm: true.",
      inputSchema: {
        connectionId: z.string(),
        ...buildObjectSchema,
        confirm: z.boolean().describe("Must be true to queue compile.")
      }
    },
    async (input) => {
      requireConfirmation(input.confirm, "queue TD/OMS compile");
      const response = await tdomsPost(store, input.connectionId, "OMQRSQ", "/queue", compileQueueBody(input), clientFactory);
      return result({ ok: true, response });
    }
  );

  server.registerTool(
    "tdoms_compile_queue_release",
    {
      description: "Release one object or a whole task from the compile queue through OMQRSQ/release. Requires confirm: true.",
      inputSchema: {
        connectionId: z.string(),
        ...buildObjectSchema,
        confirm: z.boolean().describe("Must be true to release compile queue.")
      }
    },
    async (input) => {
      requireConfirmation(input.confirm, "release TD/OMS compile queue");
      const response = await tdomsPost(store, input.connectionId, "OMQRSQ", "/release", compileQueueBody(input), clientFactory);
      return result({ ok: true, response });
    }
  );

  server.registerTool(
    "tdoms_compile_queue_delete",
    {
      description: "Delete held compile-queue entries through OMQRSQ/delete. Requires confirm: true.",
      inputSchema: {
        connectionId: z.string(),
        ...buildObjectSchema,
        clearAll: z.boolean().default(false).describe("Delete all occurrences for the object when true."),
        confirm: z.boolean().describe("Must be true to delete compile queue entries.")
      }
    },
    async (input) => {
      requireConfirmation(input.confirm, "delete TD/OMS compile queue entries");
      const response = await tdomsPost(store, input.connectionId, "OMQRSQ", "/delete", compileQueueBody(input, { clearAll: input.clearAll }), clientFactory);
      return result({ ok: true, response });
    }
  );

  server.registerTool(
    "tdoms_parse_compile_events",
    {
      description: "Parse IBM i EVF compile event records through OMQREV/parseEvent for a library/member.",
      inputSchema: {
        connectionId: z.string(),
        library: z.string().max(10),
        memberName: z.string().max(10)
      }
    },
    async ({ connectionId, library, memberName }) => {
      const response = await tdomsPost(store, connectionId, "OMQREV", "/parseEvent", { library, memberName }, clientFactory);
      return result({ ok: true, response });
    }
  );

  registerActionTool(server, {
    name: "tdoms_transfer_action",
    description: "Run TD/OMS transfer/checkout/promote flow actions through OMQRTO: select, prepare, execute, cancel, or progress. select/prepare/execute/cancel require confirm: true; progress is read-only.",
    service: "OMQRTO",
    actions: ["/select", "/prepare", "/execute", "/cancel", "/progress"],
    store,
    clientFactory,
    confirm: ({ action }) => action !== "/progress"
  });

  registerActionTool(server, {
    name: "tdoms_solution_action",
    description: "Run TD/OMS solution actions through OMQRSO, including connect, disconnect, change, lock, unlock, move, and multi operations. Requires confirm: true.",
    service: "OMQRSO",
    actions: ["/change", "/connect", "/disconnect", "/lock", "/unlock", "/move", "/multiChange", "/multiDisconnect", "/multiLock", "/multiMove", "/multiUnlock"],
    store,
    clientFactory,
    confirm: true
  });

  registerActionTool(server, {
    name: "tdoms_branch_action",
    description: "Run TD/OMS branch actions through OMQBRN: add, change, delete, status, stash, restore, or purge. Requires confirm: true.",
    service: "OMQRBR",
    actions: ["/add", "/change", "/delete", "/status", "/stash", "/restore", "/purge"],
    store,
    clientFactory,
    confirm: true
  });

  registerActionTool(server, {
    name: "tdoms_spool_action",
    description: "Run TD/OMS spool file actions through OMQRSF: list, fetch, or delete. delete requires confirm: true; list/fetch are read-only.",
    service: "OMQRSF",
    actions: ["/list", "/fetch", "/delete"],
    store,
    clientFactory,
    confirm: ({ action }) => action === "/delete"
  });

  registerActionTool(server, {
    name: "tdoms_log_action",
    description: "Read TD/OMS log history/details through OMQLOG: getLogHistory, listMessages, or getMessage.",
    service: "OMQRLH",
    actions: ["/getLogHistory", "/listMessages", "/getMessage"],
    store,
    clientFactory,
    confirm: false
  });

  registerActionTool(server, {
    name: "tdoms_remote_job_action",
    description: "Run TD/OMS remote job monitor actions through OMQJOB: close or reopen. Requires confirm: true.",
    service: "OMQRRJ",
    actions: ["/close", "/reopen"],
    store,
    clientFactory,
    confirm: true
  });

  registerActionTool(server, {
    name: "tdoms_object_action",
    description: "Run TD/OMS object/component actions through OMQROB: add, change, delete, relation, refill, or close. Requires confirm: true.",
    service: "OMQROB",
    actions: ["/add", "/change", "/delete", "/jobRelation", "/objectRelation", "/refill", "/close"],
    store,
    clientFactory,
    confirm: true
  });

  registerActionTool(server, {
    name: "tdoms_comment_action",
    description: "Run TD/OMS comment actions through OMQCMT. Requires confirm: true.",
    service: "OMQRCM",
    actions: ["/add", "/change", "/delete", "/reply"],
    store,
    clientFactory,
    confirm: true
  });

  registerActionTool(server, {
    name: "tdoms_label_action",
    description: "Run TD/OMS label actions through OMQLBL. Requires confirm: true except list/read style calls.",
    service: "OMQRLB",
    actions: ["/add", "/change", "/delete", "/label", "/unlabel"],
    store,
    clientFactory,
    confirm: true
  });

  registerActionTool(server, {
    name: "tdoms_user_options_action",
    description: "Run TD/OMS user option actions through OMQRUO. Requires confirm: true.",
    service: "OMQRUO",
    actions: ["/add", "/change", "/copy", "/delete", "/execute"],
    store,
    clientFactory,
    confirm: true
  });

  registerActionTool(server, {
    name: "tdoms_version_conflict_action",
    description: "Run TD/OMS version conflict actions through OMQVCS. Requires confirm: true.",
    service: "OMQRVC",
    actions: ["/confirm"],
    store,
    clientFactory,
    confirm: true
  });

  registerActionTool(server, {
    name: "tdoms_compile_override_action",
    description: "Run TD/OMS compile override actions through OMQRCO: add, change, copy, delete, or authorize. Requires confirm: true.",
    service: "OMQRCO",
    actions: ["/add", "/change", "/copy", "/delete", "/authorize"],
    store,
    clientFactory,
    confirm: true
  });

  registerActionTool(server, {
    name: "tdoms_managed_deployment_action",
    description: "Run TD/OMS managed deployment actions through OMQRMD: hold, release, purge, schedule, or close. Requires confirm: true.",
    service: "OMQRMD",
    actions: ["/hold", "/release", "/purge", "/schedule", "/close"],
    store,
    clientFactory,
    confirm: true
  });

  registerActionTool(server, {
    name: "tdoms_fill_object_action",
    description: "Run TD/OMS fill-object actions through OMQRFO: fillObject or jobStatus. fillObject requires confirm: true; jobStatus is read-only.",
    service: "OMQRFO",
    actions: ["/fillObject", "/jobStatus"],
    store,
    clientFactory,
    confirm: ({ action }) => action === "/fillObject"
  });

  registerActionTool(server, {
    name: "tdoms_new_object_action",
    description: "Raw TD/OMS new-object escape hatch through OMQRNO: add or location. Prefer tdoms_new_object_create, tdoms_new_source_member_create, or tdoms_new_object_location. OMQRNO/add uses task, environmentCode, newObject, newObjectLibrary, newObjectType, newAttribute, and newSource* field names; it does not use fixNumber, taskNumber, objectCode, objectLibrary, or objectAttribute. add requires confirm: true; location is read-only.",
    service: "OMQRNO",
    actions: ["/add", "/location"],
    store,
    clientFactory,
    confirm: ({ action }) => action === "/add",
    validateBody: validateNewObjectActionBody
  });

  registerFamilyTools(server, { store, clientFactory });

  return server;
}

export async function startMcpServer({ store, profile } = {}) {
  const selectedProfile = profile || process.env.TDOMS_MCP_PROFILE || "core";
  const server = createMcpServer({ store, profile: selectedProfile });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`TD/OMS MCP server running on stdio (${normalizeProfile(selectedProfile)} profile).`);
}

function registerAgentTools(server, { store, clientFactory, workflowPlans, clock, profile }) {
  const optionalConnectionId = z.string().optional().describe("Saved connection id. Omit when exactly one connection is configured.");
  const contextSchema = z.record(z.string(), z.unknown()).default({});

  registerAliasTool(server, "tdoms_get_current_context", "Resolve the active TD/OMS connection, programmer identity, applications, and environments without requiring Octo sign-in.", {
    connectionId: optionalConnectionId
  }, async ({ connectionId }) => {
    const resolvedId = await resolveConnectionId(store, connectionId);
    const connection = await store.getConnection(resolvedId);
    const systemInfo = await tdomsGet(store, resolvedId, "OMSINFO", "/system", clientFactory);
    const system = summarizeSystemInfo(systemInfo);
    return result({
      ok: true,
      connection,
      user: {
        tdomsUsername: connection.username,
        programmerId: String(connection.username || "").toUpperCase()
      },
      system
    });
  });

  registerAliasTool(server, "tdoms_list_capabilities", "List TD/OMS workflows and their option sets, required context, Octo wizard mapping, support level, and execution mode.", {
    support: z.enum(["supported", "unsupported"]).optional(),
    mode: z.enum(["read-only", "mutation"]).optional()
  }, async (input) => {
    const capabilities = CAPABILITIES.filter((capability) =>
      (!input.support || capability.support === input.support) && (!input.mode || capability.mode === input.mode)
    );
    return result({ ok: true, profile, count: capabilities.length, capabilities });
  });

  registerAliasTool(server, "tdoms_discover_options", "Return authoritative TD/OMS choices or structured read records for tasks, source, queues, logs, histories, and other extension-like views. Never guess values when this tool reports unsupported.", {
    connectionId: optionalConnectionId,
    workflow: z.enum(CAPABILITY_IDS).optional(),
    optionSet: z.enum(OPTION_SETS),
    context: contextSchema,
    search: z.string().optional(),
    pageNumber: z.number().int().min(1).default(1),
    recordsPerPage: z.number().int().min(1).max(50).default(50)
  }, async (input) => {
    const resolvedId = await resolveConnectionId(store, input.connectionId);
    const discovered = await discoverOptions({
      store,
      clientFactory,
      connectionId: resolvedId,
      optionSet: input.optionSet,
      context: input.context || {},
      search: input.search,
      pageNumber: input.pageNumber ?? 1,
      recordsPerPage: input.recordsPerPage ?? 50
    });
    return result({ ...discovered, workflow: input.workflow, connectionId: resolvedId });
  });

  registerAliasTool(server, "tdoms_plan_workflow", "Create a read-only, ten-minute preview for a TD/OMS mutation. Planning never calls a mutating endpoint.", {
    connectionId: optionalConnectionId,
    workflow: z.enum(CAPABILITY_IDS),
    context: contextSchema,
    selections: contextSchema,
    optionSelections: z.record(z.string(), z.string()).default({}).describe("Chosen option values keyed by option-set name. Supplied values are validated now and again before execution.")
  }, async (input) => {
    prunePlans(workflowPlans, clock());
    const capability = getCapability(input.workflow);
    const connectionId = await resolveConnectionId(store, input.connectionId);
    if (capability.support !== "supported") {
      return result({ ok: false, supported: false, workflow: capability.id, blockers: [capability.note] });
    }
    if (capability.mode !== "mutation" || !capability.execution) {
      return result({ ok: false, supported: true, workflow: capability.id, blockers: [capability.note || "This is a read-only capability and has nothing to execute."] });
    }

    const context = compact(input.context || {});
    const selections = compact(input.selections || {});
    const optionSelections = compact(input.optionSelections || {});
    const combined = { ...context, ...selections };
    const missing = capability.requiredContext.filter((field) => !hasValue(combined[field]));
    if (missing.length > 0) {
      return result({
        ok: false,
        supported: true,
        workflow: capability.id,
        blockers: [`Missing required context: ${missing.join(", ")}`],
        optionSets: capability.optionSets
      });
    }

    const optionValidation = await validateOptionSelections({
      store,
      clientFactory,
      connectionId,
      capability,
      context: combined,
      optionSelections
    });
    if (!optionValidation.ok) {
      return result({ ok: false, supported: true, workflow: capability.id, blockers: optionValidation.blockers, optionSets: capability.optionSets });
    }

    const execution = resolveExecution(capability, combined);
    const body = buildWorkflowBody(capability, context, selections);
    const snapshot = await readWorkflowState({ store, clientFactory, connectionId, capability, context: combined });
    const createdAt = clock();
    const expiresAt = createdAt + 10 * 60 * 1000;
    const planId = crypto.randomUUID();
    const plan = {
      planId,
      workflow: capability.id,
      connectionId,
      execution,
      body,
      context,
      selections,
      optionSelections,
      snapshot,
      state: "pending",
      createdAt,
      expiresAt
    };
    plan.digest = digestPlan(plan);
    workflowPlans.set(planId, plan);

    return result({
      ok: true,
      planId,
      workflow: capability.id,
      title: capability.title,
      expiresAt: new Date(expiresAt).toISOString(),
      preview: { execution, body },
      optionSets: capability.optionSets,
      warnings: snapshot.ok ? [] : [`Current-state snapshot unavailable: ${snapshot.error}`],
      next: "Review the preview, obtain explicit user approval, then call tdoms_execute_workflow with this planId and confirm: true."
    });
  });

  registerAliasTool(server, "tdoms_execute_workflow", "Execute one previously planned TD/OMS mutation after revalidating current state. Requires the matching planId and confirm: true.", {
    planId: z.string(),
    confirm: z.boolean()
  }, async ({ planId, confirm }) => {
    requireConfirmation(confirm, "execute the planned TD/OMS workflow");
    const plan = workflowPlans.get(planId);
    if (!plan) {
      throw new Error("Workflow plan not found. Create a new plan with tdoms_plan_workflow.");
    }
    if (plan.state !== "pending") {
      throw new Error(`Workflow plan is ${plan.state} and cannot be executed again.`);
    }
    if (clock() >= plan.expiresAt) {
      plan.state = "expired";
      throw new Error("Workflow plan expired. Create and approve a new plan.");
    }
    if (plan.digest !== digestPlan(plan)) {
      throw new Error("Workflow plan integrity check failed. Create a new plan.");
    }

    const capability = getCapability(plan.workflow);
    assertAllowedExecution(capability, plan.execution);
    const optionValidation = await validateOptionSelections({
      store,
      clientFactory,
      connectionId: plan.connectionId,
      capability,
      context: { ...plan.context, ...plan.selections },
      optionSelections: plan.optionSelections
    });
    if (!optionValidation.ok) {
      plan.state = "stale";
      throw new Error(`Selected TD/OMS options changed after planning: ${optionValidation.blockers.join("; ")}`);
    }
    const current = await readWorkflowState({
      store,
      clientFactory,
      connectionId: plan.connectionId,
      capability,
      context: { ...plan.context, ...plan.selections }
    });
    if (plan.snapshot.ok && (!current.ok || current.digest !== plan.snapshot.digest)) {
      plan.state = "stale";
      throw new Error("TD/OMS state changed after planning. Create a new plan and review the updated choices.");
    }

    const response = await tdomsPost(
      store,
      plan.connectionId,
      plan.execution.service,
      plan.execution.path,
      plan.body,
      clientFactory
    );
    plan.state = "executed";
    plan.executedAt = clock();
    plan.response = response;
    return result({ ok: true, planId, workflow: plan.workflow, state: plan.state, response });
  });

  registerAliasTool(server, "tdoms_get_workflow_status", "Get the state and result of a planned workflow without changing TD/OMS.", {
    planId: z.string()
  }, async ({ planId }) => {
    const plan = workflowPlans.get(planId);
    if (!plan) {
      return result({ ok: false, state: "not-found", planId });
    }
    if (plan.state === "pending" && clock() >= plan.expiresAt) {
      plan.state = "expired";
    }
    return result({
      ok: true,
      planId,
      workflow: plan.workflow,
      state: plan.state,
      createdAt: new Date(plan.createdAt).toISOString(),
      expiresAt: new Date(plan.expiresAt).toISOString(),
      executedAt: plan.executedAt ? new Date(plan.executedAt).toISOString() : undefined,
      response: plan.response
    });
  });
}

async function discoverOptions({ store, clientFactory, connectionId, optionSet, context, search, pageNumber, recordsPerPage }) {
  try {
    if (optionSet === "applications" || optionSet === "environments") {
      const raw = await tdomsGet(store, connectionId, "OMSINFO", "/system", clientFactory);
      const applications = summarizeSystemInfo(raw).applications;
      const rows = optionSet === "applications"
        ? applications.map((application) => ({ value: application.applicationCode, label: application.applicationName || application.applicationCode, metadata: application }))
        : applications.flatMap((application) => [
          environmentOption(application, "developmentEnvironment", "Development"),
          environmentOption(application, "productionEnvironment", "Production"),
          environmentOption(application, "emergencyEnvironment", "Emergency")
        ].filter(Boolean));
      return optionResult(optionSet, rows, { kind: "OMSINFO/system", authoritative: true }, search);
    }

    if (optionSet === "transferTargets" || optionSet === "subEnvironments") {
      const application = context.application || context.applicationCode;
      const taskNumber = context.taskNumber || context.task || context.fixNumber;
      if (!application || !taskNumber) {
        return unsupportedOptions(optionSet, ["applicationCode", "taskNumber"], "Transfer target discovery requires application and task context.");
      }
      const response = await tdomsPost(store, connectionId, "OMQRTO", "/select", compact({
        action: context.action || "Checkout",
        application,
        taskNumber,
        fromEnvironment: context.fromEnvironment || " ",
        objectList: context.objectList || []
      }), clientFactory);
      const candidates = optionSet === "subEnvironments"
        ? collectNamedObjects(response, /subenvironment/i)
        : collectNamedObjects(response, /target|environment/i);
      return optionResult(optionSet, candidates.map(normalizeRemoteOption), { kind: "OMQRTO/select", authoritative: true }, search, response);
    }

    if (optionSet === "objectTemplates" || optionSet === "objectLocations") {
      const task = context.task || context.taskNumber || context.fixNumber;
      const required = ["applicationCode", "environmentCode", "objectType", "objectAttribute"].filter((field) => !hasValue(context[field]));
      if (!task) required.push("taskNumber");
      if (required.length > 0) {
        return unsupportedOptions(optionSet, required, "New-object choices are resolved by OMQRNO/location after object context is known.");
      }
      const response = await tdomsPost(store, connectionId, "OMQRNO", "/location", {
        applicationCode: context.applicationCode,
        environmentCode: context.environmentCode,
        task,
        objectType: context.objectType,
        objectAttribute: context.objectAttribute
      }, clientFactory);
      const candidates = optionSet === "objectLocations"
        ? collectLocationOptions(response)
        : collectNamedObjects(response, /template/i);
      return optionResult(optionSet, candidates.map(normalizeRemoteOption), { kind: "OMQRNO/location", authoritative: true }, search, response);
    }

    if (optionSet === "source") {
      const required = ["objectCode", "objectType", "objectLibrary"].filter((field) => !hasValue(context[field]));
      if (required.length > 0) return unsupportedOptions(optionSet, required, "Source reads require an object, type, and library.");
      const response = await tdomsPost(store, connectionId, "OMRSRC", "/object/get", compact({
        applicationCode: context.applicationCode,
        taskNumber: context.taskNumber || context.task || context.fixNumber,
        path: context.path,
        objectCode: context.objectCode,
        objectType: context.objectType,
        objectLibrary: context.objectLibrary,
        memberCode: context.memberCode,
        pageNumber: context.pageNumber || 1
      }), clientFactory);
      return {
        ...optionResult(optionSet, [{
          value: [context.objectLibrary, context.objectCode, context.memberCode].filter(Boolean).join("/"),
          label: context.memberCode || context.objectCode,
          metadata: response
        }], { kind: "OMRSRC/object/get", authoritative: true }, search),
        sourceTextUtf8: decodeBase64Text(response?.sourceCode),
        sourceCodeBase64: response?.sourceCode
      };
    }

    if (optionSet === "spoolFiles") {
      const response = await tdomsPost(store, connectionId, "OMQRSF", "/list", context, clientFactory);
      const candidates = collectNamedObjects(response, /spool|record|file/i);
      return optionResult(optionSet, candidates.map(normalizeRemoteOption), { kind: "OMQRSF/list", authoritative: true }, search, response);
    }

    if (optionSet === "logs") {
      const response = await tdomsPost(store, connectionId, "OMQRLH", "/getLogHistory", compact({
        applicationCode: context.applicationCode,
        fixNumber: context.fixNumber || context.taskNumber || context.task,
        qualifiedJobName: context.qualifiedJobName,
        pageNumber: context.pageNumber || pageNumber,
        recordsPerPage: context.recordsPerPage || recordsPerPage
      }), clientFactory);
      const candidates = collectNamedObjects(response, /log|record|message/i);
      return optionResult(optionSet, candidates.map(normalizeRemoteOption), { kind: "OMQRLH/getLogHistory", authoritative: true }, search, response);
    }

    if (optionSet === "dependencies") {
      const endpointPath = context.path || buildImpactPath(context);
      if (!endpointPath) return unsupportedOptions(optionSet, ["path or objectCode/objectType/objectLibrary/memberCode"], "Dependency reads require a complete OMQRIA reference path.");
      const response = await tdomsGet(store, connectionId, "OMQRIA", endpointPath, clientFactory);
      const candidates = collectObjectNodes(response?.reportResult || response);
      return optionResult(optionSet, candidates.map(normalizeRemoteOption), { kind: `OMQRIA${endpointPath}`, authoritative: true }, search, response);
    }

    const spec = DATABASE_OPTION_SPECS[optionSet];
    if (!spec) {
      return unsupportedOptions(optionSet, [], "No documented TD/OMS source is available for this option set.");
    }
    const contextualSelections = optionContextSelections(context, spec);
    if (optionSet === "tasks" && !context.programmer && context.allUsers !== true) {
      const connection = await store.getConnection(connectionId);
      if (connection?.username) contextualSelections.push({ field: "programmer", value: String(connection.username).toUpperCase(), operator: "EQ" });
    }
    const response = await queryDatabase(store, connectionId, {
      table: spec.table,
      returnFields: spec.fields,
      fieldSelections: contextualSelections,
      pageNumber,
      recordsPerPage,
      returnTotalRecords: true,
      distinct: spec.distinct !== false
    }, clientFactory);
    const rows = extractRecords(response);
    const options = rows.map((row) => optionFromRecord(row, spec)).filter((option) => option.value);
    return optionResult(optionSet, options, { kind: `OMRDBA/${spec.table}`, authoritative: spec.authoritative !== false }, search, response);
  } catch (error) {
    return {
      ok: true,
      supported: false,
      optionSet,
      source: { kind: "unavailable", authoritative: false },
      options: [],
      warnings: [String(error?.message || error)],
      next: "Use a documented site-specific TD/OMS source or ask the user for this value. Do not guess."
    };
  }
}

const DATABASE_OPTION_SPECS = {
  programmers: { table: "OMXFix", fields: ["programmer"], value: ["programmer"], contextFields: ["applicationCode"], authoritative: false },
  userClasses: { table: "OMXFix", fields: ["programmer"], value: ["programmer"], contextFields: ["applicationCode"], authoritative: false },
  taskStatuses: { table: "OMXFix", fields: ["fixStatus"], value: ["fixStatus"], contextFields: ["applicationCode"], authoritative: false },
  taskTypes: { table: "OMXFix", fields: ["fixType"], value: ["fixType"], contextFields: ["applicationCode"], authoritative: false },
  releases: { table: "OMXFix", fields: ["release"], value: ["release"], contextFields: ["applicationCode"], authoritative: false },
  priorities: { table: "OMXFix", fields: ["priorityNumeric"], value: ["priorityNumeric"], contextFields: ["applicationCode"], authoritative: false },
  branchesPaths: { table: "OMXTransferPath", fields: ["pathCode", "transferPathDescription", "pathType"], value: ["pathCode"], label: ["transferPathDescription", "pathCode"], contextFields: ["applicationCode"] },
  taskObjects: { table: "OMXSolutionExtended", value: ["objectCode", "memberCode"], label: ["objectDescription", "objectCode"], contextFields: ["applicationCode", "taskNumber", "objectCode", "objectType", "objectLibrary", "memberCode"] },
  solutions: { table: "OMXSolutionExtended", value: ["solutionNumber", "objectCode", "memberCode"], label: ["shortSolutionDescription", "objectDescription", "objectCode"], contextFields: ["applicationCode", "taskNumber", "objectCode", "objectType", "objectLibrary", "memberCode"] },
  completionReasons: { table: "OMXFix", fields: ["reasonCode"], value: ["reasonCode"], contextFields: ["applicationCode"], authoritative: false },
  ratificationReasons: { table: "OMXFix", fields: ["reasonCode"], value: ["reasonCode"], contextFields: ["applicationCode"], authoritative: false },
  memberAttributes: { table: "OMXObjectDetailExtended", fields: ["memberAttributeMBSEU"], value: ["memberAttributeMBSEU"], contextFields: ["applicationCode", "objectCode", "objectLibrary", "memberCode"] },
  solutionTypes: { table: "OMXSolutionExtended", fields: ["solutionType"], value: ["solutionType"], contextFields: ["applicationCode"], authoritative: false },
  compileOverrides: { table: "OMXSolutionOverride", value: ["objectCode", "relatedObjectCode", "statusField"], label: ["objectCode", "relatedObjectCode", "statusField"], contextFields: ["applicationCode", "taskNumber", "objectCode", "objectType", "memberCode"] },
  labels: { table: "OMXLabel", value: ["labelCode", "labelID"], label: ["labelDescription", "labelCode"], contextFields: [] },
  revisions: { table: "OMXObjectTransferHistory", value: ["transferCode", "versionNumber", "systemDate"], label: ["objectCode", "transferCode", "versionNumber"], contextFields: ["applicationCode", "objectCode", "objectType", "memberCode"] },
  conflicts: { table: "OMXObjectVersionConflict", value: ["conflictNumber", "objectCode"], label: ["conflictDescription", "objectCode"], contextFields: ["applicationCode", "objectCode", "objectType", "memberCode"] },
  remoteJobs: { table: "OMXRemoteJobMonitorExtended", value: ["transferCode", "qualifiedJobName"], label: ["shortFixDescription", "transferCode", "qualifiedJobName"], contextFields: ["applicationCode", "taskNumber"] },
  trackerLinks: { table: "OMXRemoteIssueInformation", value: ["issueUrl", "remoteIssueNumber", "trackerIssueUrl"], label: ["issueTitle", "remoteIssueNumber", "issueUrl"], contextFields: ["applicationCode", "taskNumber"] },
  userOptions: { table: "OMXUserOption", value: ["userOption3", "userOption", "optionCode"], label: ["userOptionDescription", "description", "userOption3"], contextFields: [] },
  tasks: { table: "OMXFix", value: ["fixNumber"], label: ["shortFixDescription", "fixNumber"], distinct: false, contextFields: ["applicationCode", "taskNumber"] },
  requests: { table: "OMXRequest", value: ["requestNumber"], label: ["shortRequestDescription", "requestNumber"], distinct: false, contextFields: ["applicationCode", "requestNumber"] },
  components: { table: "OMXObjectExtended", value: ["objectCode", "memberCode"], label: ["objectDescription", "objectCode"], distinct: false, contextFields: ["applicationCode", "objectCode", "objectType", "objectLibrary", "memberCode"] },
  connectionLists: { table: "OMXConnectionListExtended", value: ["connectionListCode", "listCode"], label: ["connectionListDescription", "connectionListCode"], distinct: false, contextFields: ["applicationCode"] },
  buildQueue: { table: "OMXCreateObjectMonitorExtended", value: ["qualifiedJobName", "objectCode"], label: ["statusDescription", "objectCode"], distinct: false, contextFields: ["applicationCode", "taskNumber", "objectCode", "objectType", "objectLibrary", "memberCode"] },
  compileResults: { table: "OMXCreateObjectMonitorExtended", value: ["qualifiedJobName", "objectCode"], label: ["compileStatus", "objectCode"], distinct: false, contextFields: ["applicationCode", "taskNumber", "objectCode", "objectType", "objectLibrary", "memberCode"] },
  transferHistory: { table: "OMXObjectTransferHistory", value: ["transferCode", "objectCode"], label: ["objectCode", "transferCode"], distinct: false, contextFields: ["applicationCode", "objectCode", "objectType", "memberCode"] },
  trackerRecords: { table: "OMXRequestTaskLink", value: ["uUID", "urlToItem", "taskNumber"], label: ["remoteIssueInformation", "taskNumber", "requestNumber"], distinct: false, contextFields: ["applicationCode", "taskNumber", "requestNumber"], taskField: "taskNumber" },
  dashboards: { table: "OMDSH", value: ["uUID", "dashboardCode", "name"], label: ["descriptionType", "dashboardDescription", "name", "dashboardCode"], distinct: false, contextFields: [] }
};

async function readWorkflowState({ store, clientFactory, connectionId, capability, context }) {
  if (!capability.stateTable) {
    return { ok: true, digest: hashValue({ workflow: capability.id, context: stableValue(context) }), records: [] };
  }
  try {
    const response = await queryDatabase(store, connectionId, {
      table: capability.stateTable,
      fieldSelections: optionContextSelections(context),
      pageNumber: 1,
      recordsPerPage: 50,
      returnTotalRecords: true
    }, clientFactory);
    const records = extractRecords(response);
    return { ok: true, digest: hashValue(records), records };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function resolveConnectionId(store, requestedId) {
  const connections = await store.listConnections();
  if (requestedId) {
    if (!connections.some((connection) => connection.id === requestedId)) {
      throw new Error(`Connection not found: ${requestedId}`);
    }
    return requestedId;
  }
  if (connections.length === 1) {
    return connections[0].id;
  }
  if (connections.length === 0) {
    throw new Error("No TD/OMS connection is configured. Add one through the localhost TD/OMS MCP UI.");
  }
  throw new Error(`Multiple TD/OMS connections are configured. Choose connectionId: ${connections.map((connection) => `${connection.name} (${connection.id})`).join(", ")}`);
}

function resolveExecution(capability, values) {
  const execution = { ...capability.execution };
  if (capability.id === "transfer" && values.transferNumber) {
    execution.path = "/execute";
  }
  if (capability.id === "compile-override" && ["add", "change", "copy", "delete", "authorize"].includes(values.action)) {
    execution.path = `/${values.action}`;
  }
  if (capability.id === "manage-label" && ["add", "change", "delete", "label", "unlabel"].includes(values.action)) {
    execution.path = `/${values.action}`;
  }
  return execution;
}

function buildWorkflowBody(capability, context, selections) {
  if (selections.requestBody && typeof selections.requestBody === "object" && !Array.isArray(selections.requestBody)) {
    return compact(selections.requestBody);
  }
  const body = compact({ ...context, ...selections });
  delete body.requestBody;
  delete body.action;
  if (capability.id === "new-object" && body.taskNumber && !body.task) {
    body.task = body.taskNumber;
    delete body.taskNumber;
  }
  if (capability.id === "transfer") {
    if (body.applicationCode && !body.application) body.application = body.applicationCode;
    delete body.applicationCode;
  }
  return body;
}

function assertAllowedExecution(capability, execution) {
  const allowed = new Set([`${capability.execution?.service}${capability.execution?.path}`]);
  if (capability.id === "transfer") allowed.add("OMQRTO/execute");
  if (capability.id === "compile-override") ["add", "change", "copy", "delete", "authorize"].forEach((action) => allowed.add(`OMQRCO/${action}`));
  if (capability.id === "manage-label") ["add", "change", "delete", "label", "unlabel"].forEach((action) => allowed.add(`OMQRLB/${action}`));
  if (!allowed.has(`${execution.service}${execution.path}`)) {
    throw new Error(`Execution endpoint is not allowed for workflow ${capability.id}.`);
  }
}

function optionContextSelections(context, spec = {}) {
  const allowed = new Set(spec.contextFields || ["applicationCode", "taskNumber", "requestNumber", "pathCode", "objectCode", "objectType", "objectLibrary", "memberCode"]);
  return compactArray([
    allowed.has("applicationCode") && context.applicationCode && { field: "applicationCode", value: context.applicationCode, operator: "EQ" },
    allowed.has("taskNumber") && (context.taskNumber || context.task || context.fixNumber) && { field: spec.taskField || "fixNumber", value: context.taskNumber || context.task || context.fixNumber, operator: "EQ" },
    allowed.has("requestNumber") && context.requestNumber && { field: "requestNumber", value: context.requestNumber, operator: "EQ" },
    allowed.has("pathCode") && context.pathCode && { field: "pathCode", value: context.pathCode, operator: "EQ" },
    allowed.has("objectCode") && context.objectCode && { field: "objectCode", value: context.objectCode, operator: "EQ" },
    allowed.has("objectType") && context.objectType && { field: "objectType", value: context.objectType, operator: "EQ" },
    allowed.has("objectLibrary") && context.objectLibrary && { field: "objectLibrary", value: context.objectLibrary, operator: "EQ" },
    allowed.has("memberCode") && context.memberCode && { field: "memberCode", value: context.memberCode, operator: "EQ" }
  ]);
}

function buildImpactPath(context) {
  if (![context.objectCode, context.objectType, context.objectLibrary, context.memberCode].every(hasValue)) return undefined;
  return `/ref/${encodeURIComponent(context.objectCode)}/${encodeURIComponent(context.objectType)}/${encodeURIComponent(context.objectLibrary)}/${encodeURIComponent(context.memberCode)}`;
}

function extractRecords(response) {
  if (Array.isArray(response)) return response;
  for (const candidate of [response?.records, response?.listOutput?.records, response?.data?.records, response?.result?.records]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function optionFromRecord(record, spec) {
  const value = firstValue(record, spec.value || []);
  const label = firstValue(record, spec.label || spec.value || []) || value;
  return { value: String(value || ""), label: String(label || value || ""), enabled: true, selected: false, description: "", metadata: record };
}

function firstValue(record, fields) {
  for (const field of fields) {
    if (hasValue(record?.[field])) return record[field];
  }
  return undefined;
}

function optionResult(optionSet, options, source, search, raw) {
  const failure = tdomsFailure(raw);
  if (failure) {
    return {
      ok: true,
      supported: false,
      optionSet,
      source: { ...source, authoritative: false },
      count: 0,
      options: [],
      warnings: [failure],
      next: "Use another documented TD/OMS source or ask the user. Do not guess."
    };
  }
  const normalized = deduplicateOptions(options.map(normalizeOption));
  const filtered = search
    ? normalized.filter((option) => `${option.value} ${option.label} ${option.description}`.toLowerCase().includes(search.toLowerCase()))
    : normalized;
  const warnings = [];
  if (source.authoritative === false) warnings.push("Choices are inferred from existing TD/OMS records; confirm site policy when the workflow requires an authoritative configured list.");
  if (filtered.length === 0) warnings.push("TD/OMS returned no choices for the supplied context.");
  return {
    ok: true,
    supported: true,
    optionSet,
    source,
    count: filtered.length,
    options: filtered,
    warnings,
    next: filtered.length > 0 ? "Choose one of these returned values; do not substitute an unlisted value." : "Review the context or ask the user for guidance.",
    raw
  };
}

function tdomsFailure(response) {
  if (!response || typeof response !== "object") return undefined;
  const status = response.returnStatus?.status || response.status;
  if (!/^\*(TERM|ERROR|FAIL)/i.test(String(status || ""))) return undefined;
  const messages = response.returnStatus?.messages || response.messages;
  const values = Array.isArray(messages) ? messages : messages ? [messages] : [];
  return values
    .map((message) => message?.messageTextExtended || message?.messageText || message?.message || String(message))
    .filter(Boolean)
    .join("; ") || `TD/OMS returned terminal status ${status}.`;
}

function unsupportedOptions(optionSet, requiredContext, warning) {
  return {
    ok: true,
    supported: false,
    optionSet,
    requiredContext,
    source: { kind: "unavailable", authoritative: false },
    options: [],
    warnings: [warning],
    next: "Supply the missing context or ask the user. Do not guess."
  };
}

function environmentOption(application, field, role) {
  const value = application[field];
  if (!hasValue(value)) return undefined;
  return { value, label: `${value} (${role})`, metadata: { applicationCode: application.applicationCode, role } };
}

function collectNamedObjects(value, keyPattern, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const entry of value) collectNamedObjects(entry, keyPattern, output);
    return output;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (keyPattern.test(key) && Array.isArray(entry)) {
      output.push(...entry.map((item) => typeof item === "object" ? item : { value: item }));
    } else if (entry && typeof entry === "object") {
      collectNamedObjects(entry, keyPattern, output);
    }
  }
  return output;
}

function collectObjectNodes(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const entry of value) collectObjectNodes(entry, output);
    return output;
  }
  if (hasValue(value.objectCode) || hasValue(value.refLink)) output.push(value);
  for (const entry of Object.values(value)) {
    if (entry && typeof entry === "object") collectObjectNodes(entry, output);
  }
  return output;
}

function collectLocationOptions(response) {
  const options = [];
  for (const [field, label] of [
    ["objectLibrary", "Object library"],
    ["sourceLibrary", "Source library"],
    ["sourceFile", "Source file"],
    ["environmentCode", "Environment"]
  ]) {
    if (hasValue(response?.[field])) options.push({ value: response[field], label: `${response[field]} (${label})`, field });
  }
  options.push(...collectNamedObjects(response, /location|library|source/i));
  return options;
}

function normalizeRemoteOption(value) {
  if (!value || typeof value !== "object") return { value: String(value || "") };
  return {
    value: firstValue(value, ["value", "refLink", "spoolFileName", "qualifiedJobName", "transferCode", "messageId", "environmentCode", "targetEnvironment", "objectCode", "code", "id", "name", "library", "templateName"]),
    label: firstValue(value, ["label", "description", "objectDescription", "messageText", "environmentDescription", "name", "spoolFileName", "qualifiedJobName", "value", "environmentCode", "targetEnvironment", "objectCode"]),
    enabled: value.enabled !== false && value.disabled !== true,
    selected: value.selected === true,
    description: value.description || "",
    metadata: value
  };
}

function normalizeOption(option) {
  return {
    value: String(option.value ?? ""),
    label: String(option.label ?? option.value ?? ""),
    enabled: option.enabled !== false,
    selected: option.selected === true,
    description: String(option.description || ""),
    metadata: option.metadata || {}
  };
}

function deduplicateOptions(options) {
  const seen = new Set();
  return options.filter((option) => {
    if (!option.value || seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

function digestPlan(plan) {
  return hashValue({
    planId: plan.planId,
    workflow: plan.workflow,
    connectionId: plan.connectionId,
    execution: plan.execution,
    body: plan.body,
    context: plan.context,
    selections: plan.selections,
    optionSelections: plan.optionSelections,
    snapshot: plan.snapshot,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt
  });
}

async function validateOptionSelections({ store, clientFactory, connectionId, capability, context, optionSelections }) {
  const blockers = [];
  for (const [optionSet, selectedValue] of Object.entries(optionSelections || {})) {
    if (!capability.optionSets.includes(optionSet)) {
      blockers.push(`${optionSet} is not an option set for ${capability.id}`);
      continue;
    }
    const discovered = await discoverOptions({
      store,
      clientFactory,
      connectionId,
      optionSet,
      context,
      pageNumber: 1,
      recordsPerPage: 50
    });
    if (!discovered.supported) {
      blockers.push(`${optionSet} could not be validated: ${discovered.warnings?.join("; ") || "source unavailable"}`);
      continue;
    }
    const match = discovered.options.find((option) => option.value === String(selectedValue));
    if (!match) blockers.push(`${selectedValue} is not a current ${optionSet} choice`);
    else if (!match.enabled) blockers.push(`${selectedValue} is currently disabled for ${optionSet}`);
  }
  return { ok: blockers.length === 0, blockers };
}

function hashValue(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function prunePlans(plans, now) {
  for (const [planId, plan] of plans) {
    if (plan.state !== "pending" && now - (plan.executedAt || plan.expiresAt) > 10 * 60 * 1000) plans.delete(planId);
  }
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function normalizeProfile(profile) {
  const normalized = String(profile || "core").toLowerCase();
  if (!["core", "full"].includes(normalized)) {
    throw new Error(`Unknown TD/OMS MCP profile: ${profile}. Expected core or full.`);
  }
  return normalized;
}

async function queryDatabase(store, connectionId, input, clientFactory) {
  return tdomsPost(store, connectionId, "OMRDBA", "/get", compact({
    listInput: {
      table: input.table,
      pageNumber: input.pageNumber,
      recordsPerPage: input.recordsPerPage,
      returnTotalRecords: input.returnTotalRecords,
      returnFields: input.returnFields,
      whereClause: input.whereClause,
      fieldSelections: input.fieldSelections,
      distinct: input.distinct,
      schemaOverride: input.schemaOverride
    },
    sortFields: input.sortFields,
    returnExtendedMessageText: true
  }), clientFactory);
}

async function tdomsPost(store, connectionId, service, path, body, clientFactory) {
  const { connection, client, token } = await getAuthenticatedClient(store, connectionId, clientFactory);
  try {
    return await client.post(service, path, body, token);
  } catch (error) {
    if (!isUnauthorized(error)) {
      throw error;
    }

    const login = await loginAndSave(store, connection.id, clientFactory);
    return login.client.post(service, path, body, login.token);
  }
}

async function tdomsGet(store, connectionId, service, path, clientFactory) {
  const { connection, client, token } = await getAuthenticatedClient(store, connectionId, clientFactory);
  try {
    if (typeof client.get === "function") {
      return await client.get(service, path, token);
    }
    return await client.request(service, path, { method: "GET", token });
  } catch (error) {
    if (!isUnauthorized(error)) {
      throw error;
    }

    const login = await loginAndSave(store, connection.id, clientFactory);
    if (typeof login.client.get === "function") {
      return login.client.get(service, path, login.token);
    }
    return login.client.request(service, path, { method: "GET", token: login.token });
  }
}

async function readAllSourcePages(store, connectionId, input, clientFactory) {
  const first = await readSourcePage(store, connectionId, input, input.pageNumber && input.pageNumber > 0 ? input.pageNumber : 1, clientFactory);
  const numberOfPages = Math.max(1, Number(first.numberOfPages || 1));
  const pages = [first];

  for (let pageNumber = 2; pageNumber <= numberOfPages; pageNumber += 1) {
    pages.push(await readSourcePage(store, connectionId, input, pageNumber, clientFactory));
  }

  const sourceTextUtf8 = pages.map((page) => decodeBase64Text(page.sourceCode)).join("");
  return {
    response: first,
    pages: pages.map((page) => ({
      pageNumber: page.pageNumber,
      numberOfPages: page.numberOfPages,
      sourceCodeBase64Length: page.sourceCode ? String(page.sourceCode).length : 0
    })),
    sourceTextUtf8,
    sourceCodeBase64: Buffer.from(sourceTextUtf8, "utf8").toString("base64"),
    canEdit: first.canEdit,
    ccsid: first.ccsid,
    sourceType: first.sourceType,
    maximumLineLength: first.maximumLineLength,
    lastChangeDate: first.lastChangeDate,
    numberOfPages
  };
}

async function readSourcePage(store, connectionId, input, pageNumber, clientFactory) {
  return tdomsPost(store, connectionId, "OMRSRC", "/object/get", compact({
    applicationCode: input.applicationCode,
    taskNumber: input.taskNumber,
    path: input.path,
    objectCode: input.objectCode,
    objectType: input.objectType,
    objectLibrary: input.objectLibrary,
    memberCode: input.memberCode,
    pageNumber
  }), clientFactory);
}

async function saveAllSourcePages(store, connectionId, input, clientFactory) {
  const chunks = splitTextByUtf8Bytes(input.sourceText, input.maxPageBytes || 48000);
  const numberOfPages = chunks.length || 1;
  const responses = [];

  for (let index = 0; index < numberOfPages; index += 1) {
    const sourceCode = Buffer.from(chunks[index] || "", "utf8").toString("base64");
    responses.push(await tdomsPost(store, connectionId, "OMRSRC", "/object/save", compact({
      applicationCode: input.applicationCode,
      taskNumber: input.taskNumber,
      path: input.path,
      objectCode: input.objectCode,
      objectType: input.objectType,
      objectLibrary: input.objectLibrary,
      memberCode: input.memberCode,
      pageNumber: index + 1,
      numberOfPages,
      sourceCode,
      ccsid: input.ccsid,
      lastChangeDate: input.lastChangeDate,
      forceSave: input.forceSave
    }), clientFactory));
  }

  return {
    responses,
    numberOfPages,
    savedBytes: Buffer.byteLength(input.sourceText, "utf8")
  };
}

async function getAuthenticatedClient(store, connectionId, clientFactory = (connection) => new TdomsClient(connection)) {
  const connection = await store.getConnection(connectionId, { includeSecrets: true });
  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  const client = clientFactory(connection);
  if (connection.token) {
    return { connection, client, token: connection.token };
  }

  return loginAndSave(store, connectionId, clientFactory);
}

async function loginAndSave(store, connectionId, clientFactory = (connection) => new TdomsClient(connection)) {
  const connection = await store.getConnection(connectionId, { includeSecrets: true });
  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  const client = clientFactory(connection);
  const token = await client.login();
  await store.saveToken(connection.id, token);
  await store.updateStatus(connection.id, {
    lastStatus: "login-ok",
    lastLoginAt: new Date().toISOString()
  });
  return { connection, client, token };
}

function registerActionTool(server, { name, description, service, actions, store, clientFactory, confirm, validateBody }) {
  server.registerTool(
    name,
    {
      description,
      inputSchema: {
        connectionId: z.string(),
        action: z.enum(actions),
        body: z.record(z.string(), z.unknown()).default({}).describe("Request body exactly as documented by the TD/OMS REST API for this action."),
        confirm: z.boolean().optional().describe("Must be true for actions that can create, change, process, delete, release, transfer, close, or otherwise mutate TD/OMS state.")
      }
    },
    async (input) => {
      const needsConfirmation = typeof confirm === "function" ? confirm(input) : confirm;
      if (needsConfirmation) {
        requireConfirmation(input.confirm, `run ${service}${input.action}`);
      }
      if (validateBody) {
        validateBody(input);
      }
      const response = await tdomsPost(store, input.connectionId, service, input.action, input.body, clientFactory);
      return result({ ok: true, response });
    }
  );
}

function validateNewObjectActionBody({ action, body = {} }) {
  if (!["/add", "/location"].includes(action)) {
    return;
  }

  const confusingFields = action === "/add" ? {
    fixNumber: "task",
    taskNumber: "task",
    requestNumber: "task",
    objectCode: "newObject",
    objectLibrary: "newObjectLibrary",
    objectAttribute: "newAttribute",
    sourceFile: "newSourceFile",
    sourceLibrary: "newSourceLibrary",
    sourceMember: "newSourceMember",
    sourceAttribute: "newSourceAttribute"
  } : {
    fixNumber: "task",
    taskNumber: "task",
    requestNumber: "task",
    objectCode: "objectType/objectAttribute",
    objectLibrary: "remove objectLibrary",
    sourceFile: "remove sourceFile",
    sourceLibrary: "remove sourceLibrary",
    sourceMember: "remove sourceMember",
    sourceAttribute: "remove sourceAttribute"
  };
  const found = Object.entries(confusingFields)
    .filter(([field]) => Object.prototype.hasOwnProperty.call(body, field))
    .map(([field, replacement]) => replacement ? `${field} -> ${replacement}` : field);

  if (found.length > 0) {
    throw new Error(`OMQRNO ${action} body uses documented NewObjectAPI field names. Replace: ${found.join(", ")}. Prefer tdoms_new_object_create, tdoms_new_source_member_create, or tdoms_new_object_location.`);
  }

  if (action === "/add") {
    const required = ["applicationCode", "task", "environmentCode", "newObject", "newObjectLibrary", "newObjectType", "newAttribute"];
    const missing = required.filter((field) => body[field] === undefined);
    if (missing.length > 0) {
      throw new Error(`OMQRNO /add body is missing required NewObjectAPI fields: ${missing.join(", ")}. Prefer tdoms_new_object_create or tdoms_new_source_member_create.`);
    }
  }

  if (action === "/location") {
    const required = ["applicationCode", "task", "environmentCode", "objectType", "objectAttribute"];
    const missing = required.filter((field) => body[field] === undefined);
    if (missing.length > 0) {
      throw new Error(`OMQRNO /location body is missing required NewObjectAPI fields: ${missing.join(", ")}. Prefer tdoms_new_object_location.`);
    }
  }
}

function registerFamilyTools(server, { store, clientFactory }) {
  const connectionId = z.string().describe("Saved TD/OMS connection id from tdoms_connection_list.");
  const rawBody = z.record(z.string(), z.unknown()).default({}).describe("Request body exactly as documented by TD/OMS REST API.");
  const confirm = z.boolean().optional().describe("Must be true for operations that can change TD/OMS state.");
  const applicationCode = z.string().max(10).describe("TD/OMS application code.");
  const taskNumber = z.string().max(20).describe("TD/OMS task/fix number.");
  const objectCode = z.string().optional().describe("Object or source file code.");
  const objectType = z.string().optional().describe("Object type, such as *PGM, *FILE, *MODULE, or *SRVPGM.");
  const objectLibrary = z.string().optional().describe("Object/source library.");
  const memberCode = z.string().optional().describe("Member/detail name.");
  const transferObject = z.object({
    objectCode: z.string().max(128).describe("TD/OMS object code. For source members this is usually the source file, such as QRPGLESRC."),
    objectType: z.string().max(20).describe("TD/OMS object type, such as *PGM, *FILE, *MODULE, *SRVPGM, or *STMF."),
    memberCode: z.string().default("").describe("Member/detail for source-file objects. Leave blank for object-level transfers."),
    routeCode: z.string().default("").describe("Route code for IFS or routed objects. Leave blank for normal IBM i objects."),
    pathExtensionCode: z.string().default("").describe("Path extension code for IFS objects. Leave blank for normal IBM i objects.")
  });
  const environmentCode = z.string().max(10).describe("TD/OMS environment code for new object workflows, such as DEV.");
  const newObjectTemplate = z.string().optional().describe("Exact TD/OMS new-object template label from tdoms_new_object_location, such as a site-specific RPG program template.");
  const template = z.object({
    templateObjectType: z.string().optional().describe("Template object type, such as *PGM."),
    templateObject: z.string().optional().describe("Template object name."),
    templateObjectLibrary: z.string().optional().describe("Template object library."),
    templateObjectDetail: z.string().optional().describe("Template detail/member, if any.")
  }).optional().describe("Optional TD/OMS template object to copy from.");

  registerAliasTool(server, "tdoms_connection_list", "List locally saved TD/OMS connection profiles.", {}, async () => {
    const connections = await store.listConnections();
    return result({ connections });
  });

  registerAliasTool(server, "tdoms_connection_login", "Login to a saved TD/OMS connection and save the JWT.", { connectionId }, async ({ connectionId }) => {
    const { connection, client, token } = await loginAndSave(store, connectionId, clientFactory);
    const systemInfo = await client.getSystemInfo(token);
    return result({ ok: true, connection: await store.getConnection(connection.id), system: summarizeSystemInfo(systemInfo) });
  });

  registerAliasTool(server, "tdoms_connection_system_info", "Fetch TD/OMS system/application info.", {
    connectionId,
    applications: z.string().optional()
  }, async ({ connectionId, applications }) => {
    const suffix = applications ? `/system?applications=${encodeURIComponent(applications)}` : "/system";
    const systemInfo = await tdomsGet(store, connectionId, "OMSINFO", suffix, clientFactory);
    await store.updateStatus(connectionId, {
      lastStatus: "system-probe-ok",
      lastSystemProbeAt: new Date().toISOString()
    });
    return result({ ok: true, system: summarizeSystemInfo(systemInfo), raw: systemInfo });
  });

  registerAliasTool(server, "tdoms_connection_test", "Login and probe OMSINFO/system for a saved connection.", { connectionId }, async ({ connectionId }) => {
    const { connection, client, token } = await loginAndSave(store, connectionId, clientFactory);
    const systemInfo = await client.getSystemInfo(token);
    await store.updateStatus(connection.id, {
      lastStatus: "system-probe-ok",
      lastSystemProbeAt: new Date().toISOString()
    });
    return result({ ok: true, connection: await store.getConnection(connection.id), system: summarizeSystemInfo(systemInfo) });
  });

  registerAliasTool(server, "tdoms_connection_refresh_token", "Refresh the saved TD/OMS JWT by logging in again.", { connectionId }, async ({ connectionId }) => {
    const { connection, token } = await loginAndSave(store, connectionId, clientFactory);
    return result({ ok: true, connection: await store.getConnection(connection.id), tokenRefreshed: Boolean(token) });
  });

  registerAliasTool(server, "tdoms_connection_license_info", "Fetch OMSINFO/license for a saved connection.", { connectionId }, async ({ connectionId }) => {
    return result({ ok: true, response: await tdomsGet(store, connectionId, "OMSINFO", "/license", clientFactory) });
  });

  registerAliasTool(server, "tdoms_connection_user_context", "Return the locally known TD/OMS user context without secrets.", { connectionId }, async ({ connectionId }) => {
    const connection = await store.getConnection(connectionId);
    if (!connection) {
      throw new Error(`Connection not found: ${connectionId}`);
    }
    return result({ ok: true, user: { connectionId, name: connection.name, username: connection.username, baseUrl: connection.baseUrl } });
  });

  registerAliasTool(server, "tdoms_connection_applications", "List TD/OMS applications visible to the current user.", {
    connectionId,
    applications: z.string().optional()
  }, async ({ connectionId, applications }) => {
    const suffix = applications ? `/system?applications=${encodeURIComponent(applications)}` : "/system";
    const systemInfo = await tdomsGet(store, connectionId, "OMSINFO", suffix, clientFactory);
    return result({ ok: true, applications: summarizeSystemInfo(systemInfo).applications, raw: systemInfo?.applications || [] });
  });

  const queryTools = [
    ["tdoms_task_search", "Search tasks/fixes with richer family naming.", "OMXFix", ["applicationCode", "fixNumber", "shortFixDescription", "programmer", "fixStatus", "release", "pathCode", "expectedStartDate", "expectedCompletionDate"]],
    ["tdoms_task_get", "Get one task/fix by application and task number.", "OMXFix"],
    ["tdoms_task_objects", "List objects/solutions connected to a task.", "OMXSolutionExtended"],
    ["tdoms_task_requests", "List requests linked to a task.", "OMXRequestTaskLink"],
    ["tdoms_task_tickets", "List external ticket/backlink rows for a task when available.", "OMXRemoteIssueInformation"],
    ["tdoms_task_backlinks", "List task backlinks/external ticket rows when available.", "OMXRemoteIssueInformation"],
    ["tdoms_task_comments", "List comments related to a task when available.", "OMXCommentLink"],
    ["tdoms_task_labels", "List labels related to a task when available.", "OMXLabel"],
    ["tdoms_task_log_history", "List log history rows related to a task.", "OMXLogHistoryExtended"],
    ["tdoms_task_transfer_history", "List transfer history rows related to a task.", "OMXObjectTransferHistory"],
    ["tdoms_task_build_queue", "List build queue rows related to a task.", "OMXCreateObjectMonitorExtended"],
    ["tdoms_task_compile_results", "List compile result rows related to a task.", "OMXCreateObjectMonitorExtended"],
    ["tdoms_request_search", "Search TD/OMS requests.", "OMXRequest"],
    ["tdoms_request_get", "Get one TD/OMS request.", "OMXRequest"],
    ["tdoms_solution_search", "Search TD/OMS solutions/connected objects.", "OMXSolutionExtended"],
    ["tdoms_solution_get", "Get one TD/OMS solution/connected object.", "OMXSolutionExtended"],
    ["tdoms_solution_compile_overrides", "List compile overrides for a solution.", "OMXCompileOverrideExtended"],
    ["tdoms_solution_transfer_history", "List transfer history for a solution.", "OMXObjectTransferHistory"],
    ["tdoms_solution_build_queue", "List build queue rows for a solution.", "OMXCreateObjectMonitorExtended"],
    ["tdoms_solution_compile_results", "List compile results for a solution.", "OMXCreateObjectMonitorExtended"],
    ["tdoms_object_search", "Search TD/OMS objects/components.", "OMXObjectExtended"],
    ["tdoms_object_get", "Get object/component rows.", "OMXObjectExtended"],
    ["tdoms_object_details", "Get object/member detail rows.", "OMXObjectDetailExtended"],
    ["tdoms_object_members", "List object members/details.", "OMXObjectDetailExtended"],
    ["tdoms_object_transfer_history", "List object transfer history.", "OMXObjectTransferHistory"],
    ["tdoms_object_version_conflicts", "List object version conflicts.", "OMXObjectVersionConflict"],
    ["tdoms_branch_search", "Search TD/OMS branches.", "OMXTransferPath"],
    ["tdoms_branch_get", "Get TD/OMS branch rows.", "OMXTransferPath"],
    ["tdoms_branch_tasks", "List tasks assigned to a branch/path.", "OMXFixExtended"],
    ["tdoms_branch_solutions", "List solutions connected to branch tasks.", "OMXSolutionExtended"],
    ["tdoms_connection_list_get", "Get connection-list metadata rows.", "OMXConnectionListExtended"],
    ["tdoms_connection_list_entries", "List connection-list entries.", "OMXConnectionListEntryExtended"],
    ["tdoms_build_queue_list", "List build queue entries.", "OMXCreateObjectMonitorExtended"],
    ["tdoms_build_queue_for_task", "List build queue entries for a task.", "OMXCreateObjectMonitorExtended"],
    ["tdoms_build_queue_for_solution", "List build queue entries for a solution.", "OMXCreateObjectMonitorExtended"],
    ["tdoms_build_queue_for_object", "List build queue entries for an object.", "OMXCreateObjectMonitorExtended"],
    ["tdoms_compile_results", "List compile results.", "OMXCreateObjectMonitorExtended"],
    ["tdoms_compile_errors", "List compile errors/diagnostics where available.", "OMXCreateObjectMonitorExtended"],
    ["tdoms_transfer_history", "List transfer history.", "OMXObjectTransferHistory"],
    ["tdoms_managed_deployment_list", "List managed deployments.", "OMXManagedDeploymentExtended"],
    ["tdoms_remote_job_list", "List remote jobs.", "OMXRemoteJobMonitorExtended"],
    ["tdoms_remote_job_get", "Get remote job rows.", "OMXRemoteJobMonitorExtended"],
    ["tdoms_comment_list", "List comments.", "OMXComment"],
    ["tdoms_label_list", "List labels.", "OMXLabel"],
    ["tdoms_user_option_list", "List user options.", "OMXUserOption"],
    ["tdoms_dashboard_list", "List dashboard definitions.", "OMDSH"],
    ["tdoms_dashboard_missing_source", "Run/query missing-source dashboard data when represented in tables.", "OMXObjectExtended"],
    ["tdoms_dashboard_problem_transfers", "Run/query problematic transfer dashboard data when represented in tables.", "OMXObjectTransferHistory"],
    ["tdoms_tracker_search", "Search tracker/request-task style records.", "OMXRequestTaskLink"],
    ["tdoms_tracker_get", "Get tracker/request-task style records.", "OMXRequestTaskLink"],
    ["tdoms_admin_data_dictionary", "Query the TD/OMS data dictionary.", "OMXDataDictionary"],
    ["tdoms_admin_table_fields", "Query fields for a TD/OMS table from the data dictionary.", "OMXDataDictionary"],
    ["tdoms_admin_saved_searches", "List reusable saved search rows when available.", "OMXStoredSearchTerm"],
    ["tdoms_admin_saved_search_run", "Run a reusable saved search by querying stored search metadata.", "OMXStoredSearchTerm"]
  ];

  for (const [name, description, table, returnFields] of queryTools) {
    registerDatabaseTool(server, { name, description, table, returnFields, store, clientFactory });
  }

  registerAliasTool(server, "tdoms_task_details", "Fetch a task plus common extension-like related data in one read-only call.", {
    connectionId,
    applicationCode,
    taskNumber
  }, async (input) => result({
    ok: true,
    task: await safeQuery(store, input.connectionId, taskQuery("OMXFixExtended", input), clientFactory),
    objects: await safeQuery(store, input.connectionId, taskQuery("OMXSolutionExtended", input), clientFactory),
    requests: await safeQuery(store, input.connectionId, taskQuery("OMXRequestTaskLink", input), clientFactory),
    tickets: await safeQuery(store, input.connectionId, taskQuery("OMXRemoteIssueInformation", input), clientFactory),
    comments: await safeQuery(store, input.connectionId, taskQuery("OMXCommentLink", input), clientFactory),
    labels: await safeQuery(store, input.connectionId, taskQuery("OMXLabel", input), clientFactory),
    transferHistory: await safeQuery(store, input.connectionId, taskQuery("OMXObjectTransferHistory", input), clientFactory),
    buildQueue: await safeQuery(store, input.connectionId, taskQuery("OMXCreateObjectMonitorExtended", input), clientFactory),
    compileResults: await safeQuery(store, input.connectionId, taskQuery("OMXCreateObjectMonitorExtended", input), clientFactory)
  }));

  registerAliasTool(server, "tdoms_request_details", "Fetch request plus linked tasks in one read-only call.", {
    connectionId,
    applicationCode,
    requestNumber: z.string()
  }, async (input) => result({
    ok: true,
    request: await safeQuery(store, input.connectionId, requestQuery("OMXRequest", input), clientFactory),
    tasks: await safeQuery(store, input.connectionId, requestQuery("OMXRequestTaskLink", input), clientFactory)
  }));

  registerAliasTool(server, "tdoms_solution_details", "Fetch solution plus object details, transfer history, queue, and compile results.", {
    connectionId,
    applicationCode,
    taskNumber,
    objectCode,
    objectType,
    objectLibrary,
    memberCode
  }, async (input) => result({
    ok: true,
    solution: await safeQuery(store, input.connectionId, objectQuery("OMXSolutionExtended", input), clientFactory),
    objectDetails: await safeQuery(store, input.connectionId, objectQuery("OMXObjectDetailExtended", input), clientFactory),
    transferHistory: await safeQuery(store, input.connectionId, objectQuery("OMXObjectTransferHistory", input), clientFactory),
    buildQueue: await safeQuery(store, input.connectionId, objectQuery("OMXCreateObjectMonitorExtended", input), clientFactory),
    compileResults: await safeQuery(store, input.connectionId, objectQuery("OMXCreateObjectMonitorExtended", input), clientFactory)
  }));

  const actionTools = [
    ["tdoms_task_change", "Change a task through OMQRTA/change.", "OMQRTA", "/change"],
    ["tdoms_task_complete", "Complete a task through OMQRTA/complete.", "OMQRTA", "/complete"],
    ["tdoms_task_copy", "Copy a task through OMQRTA/copy.", "OMQRTA", "/copy"],
    ["tdoms_task_delete", "Delete a task through OMQRTA/delete.", "OMQRTA", "/delete"],
    ["tdoms_task_status", "Recalculate task status through OMQRTA/status.", "OMQRTA", "/status"],
    ["tdoms_task_ratify", "Ratify a task through OMQRTA/ratify.", "OMQRTA", "/ratify"],
    ["tdoms_task_link_request", "Link a request to a task through OMQRTA/link/request.", "OMQRTA", "/link/request"],
    ["tdoms_task_unlink_request", "Unlink a request from a task through OMQRTA/unlink/request.", "OMQRTA", "/unlink/request"],
    ["tdoms_task_link_ticket", "Link an external ticket/backlink through OMQRTA/link/ticket.", "OMQRTA", "/link/ticket"],
    ["tdoms_task_unlink_ticket", "Unlink an external ticket/backlink through OMQRTA/unlink/ticket.", "OMQRTA", "/unlink/ticket"],
    ["tdoms_request_create", "Create a request through OMQRRE/add.", "OMQRRE", "/add"],
    ["tdoms_request_change", "Change a request through OMQRRE/change.", "OMQRRE", "/change"],
    ["tdoms_request_complete", "Complete a request through OMQRRE/complete.", "OMQRRE", "/complete"],
    ["tdoms_request_copy", "Copy a request through OMQRRE/copy.", "OMQRRE", "/copy"],
    ["tdoms_request_delete", "Delete a request through OMQRRE/delete.", "OMQRRE", "/delete"],
    ["tdoms_request_connect_task", "Connect a request/task through OMQRRE/connect.", "OMQRRE", "/connect"],
    ["tdoms_request_disconnect_task", "Disconnect a request/task through OMQRRE/disconnect.", "OMQRRE", "/disconnect"],
    ["tdoms_request_rename", "Rename a request through OMQRRE/rename.", "OMQRRE", "/rename"],
    ["tdoms_request_ratify", "Ratify a request through OMQRRE/ratify.", "OMQRRE", "/ratify"],
    ["tdoms_solution_connect", "Connect a solution through OMQRSO/connect.", "OMQRSO", "/connect"],
    ["tdoms_solution_disconnect", "Disconnect a solution through OMQRSO/disconnect.", "OMQRSO", "/disconnect"],
    ["tdoms_solution_change", "Change a solution through OMQRSO/change.", "OMQRSO", "/change"],
    ["tdoms_solution_lock", "Lock a solution through OMQRSO/lock.", "OMQRSO", "/lock"],
    ["tdoms_solution_unlock", "Unlock a solution through OMQRSO/unlock.", "OMQRSO", "/unlock"],
    ["tdoms_solution_move", "Move a solution through OMQRSO/move.", "OMQRSO", "/move"],
    ["tdoms_object_add", "Add an object/component through OMQROB/add.", "OMQROB", "/add"],
    ["tdoms_object_change", "Change an object/component through OMQROB/change.", "OMQROB", "/change"],
    ["tdoms_object_delete", "Delete an object/component through OMQROB/delete.", "OMQROB", "/delete"],
    ["tdoms_object_refill", "Refill an object/component through OMQROB/refill.", "OMQROB", "/refill"],
    ["tdoms_object_close", "Close an object/component through OMQROB/close.", "OMQROB", "/close"],
    ["tdoms_component_change_member_attributes", "Change member attributes through the object change endpoint.", "OMQROB", "/change"],
    ["tdoms_connection_list_change", "Change a connection-list entry through OMQRCL/change.", "OMQRCL", "/change"],
    ["tdoms_connection_list_delete", "Delete a connection-list entry through OMQRCL/delete.", "OMQRCL", "/delete"],
    ["tdoms_connection_list_clear", "Clear connection-list entries through OMQRCL/delete using a caller-provided body.", "OMQRCL", "/delete"],
    ["tdoms_compile_override_add", "Add a compile override through OMQRCO/add.", "OMQRCO", "/add"],
    ["tdoms_compile_override_change", "Change a compile override through OMQRCO/change.", "OMQRCO", "/change"],
    ["tdoms_compile_override_delete", "Delete a compile override through OMQRCO/delete.", "OMQRCO", "/delete"],
    ["tdoms_compile_override_authorize", "Authorize a compile override through OMQRCO/authorize.", "OMQRCO", "/authorize"],
    ["tdoms_managed_deployment_schedule", "Schedule a managed deployment through OMQRMD/schedule.", "OMQRMD", "/schedule"],
    ["tdoms_managed_deployment_hold", "Hold a managed deployment through OMQRMD/hold.", "OMQRMD", "/hold"],
    ["tdoms_managed_deployment_release", "Release a managed deployment through OMQRMD/release.", "OMQRMD", "/release"],
    ["tdoms_managed_deployment_close", "Close a managed deployment through OMQRMD/close.", "OMQRMD", "/close"],
    ["tdoms_branch_create", "Create a branch through OMQRBR/add.", "OMQRBR", "/add"],
    ["tdoms_branch_change", "Change a branch through OMQRBR/change.", "OMQRBR", "/change"],
    ["tdoms_branch_status", "Recalculate branch status through OMQRBR/status.", "OMQRBR", "/status"],
    ["tdoms_branch_delete", "Delete a branch through OMQRBR/delete.", "OMQRBR", "/delete"],
    ["tdoms_branch_stash", "Stash a branch through OMQRBR/stash.", "OMQRBR", "/stash"],
    ["tdoms_branch_restore", "Restore a branch through OMQRBR/restore.", "OMQRBR", "/restore"],
    ["tdoms_branch_purge", "Purge a stashed branch through OMQRBR/purge.", "OMQRBR", "/purge"],
    ["tdoms_comment_add", "Add a comment through OMQRCM/add.", "OMQRCM", "/add"],
    ["tdoms_comment_change", "Change a comment through OMQRCM/change.", "OMQRCM", "/change"],
    ["tdoms_comment_reply", "Reply to a comment through OMQRCM/reply.", "OMQRCM", "/reply"],
    ["tdoms_comment_delete", "Delete a comment through OMQRCM/delete.", "OMQRCM", "/delete"],
    ["tdoms_label_add", "Add a label through OMQRLB/add.", "OMQRLB", "/add"],
    ["tdoms_label_change", "Change a label through OMQRLB/change.", "OMQRLB", "/change"],
    ["tdoms_label_delete", "Delete a label through OMQRLB/delete.", "OMQRLB", "/delete"],
    ["tdoms_label_apply", "Apply a label through OMQRLB/label.", "OMQRLB", "/label"],
    ["tdoms_label_remove", "Remove a label through OMQRLB/unlabel.", "OMQRLB", "/unlabel"],
    ["tdoms_user_option_execute", "Execute a TD/OMS user option through OMQRUO/execute.", "OMQRUO", "/execute"],
    ["tdoms_admin_saved_search_save", "Save/update reusable search metadata with a caller-provided endpoint body.", "OMRDBA", "/get"],
    ["tdoms_admin_call_program_request", "Call OMRPGM/callRequest. Advanced and always requires confirmation.", "OMRPGM", "/callRequest"]
  ];

  for (const [name, description, service, path] of actionTools) {
    registerEndpointTool(server, { name, description, service, path, store, clientFactory, confirm: true });
  }

  const readEndpointTools = [
    ["tdoms_source_get", "Read source through OMRSRC/source/get.", "OMRSRC", "/source/get"],
    ["tdoms_object_relations", "Read object relations through OMQROB/objectRelation.", "OMQROB", "/objectRelation"],
    ["tdoms_object_job_relations", "Read object job relations through OMQROB/jobRelation.", "OMQROB", "/jobRelation"],
    ["tdoms_compile_event_raw_records", "Fetch raw compile event records through OMQREV/getRawRecords.", "OMQREV", "/getRawRecords"],
    ["tdoms_compile_event_parse", "Parse compile event records through OMQREV/parseEvent.", "OMQREV", "/parseEvent"],
    ["tdoms_transfer_targets", "Select transfer targets through OMQRTO/select. Some TD/OMS configurations may treat this as a preparatory action.", "OMQRTO", "/select"],
    ["tdoms_transfer_progress", "Fetch transfer progress through OMQRTO/progress.", "OMQRTO", "/progress"],
    ["tdoms_log_history", "Fetch log history through OMQRLH/getLogHistory.", "OMQRLH", "/getLogHistory"],
    ["tdoms_log_messages", "List log messages through OMQRLH/listMessages.", "OMQRLH", "/listMessages"],
    ["tdoms_log_message_get", "Get one log message through OMQRLH/getMessage.", "OMQRLH", "/getMessage"],
    ["tdoms_spool_list", "List spool files through OMQRSF/list.", "OMQRSF", "/list"],
    ["tdoms_spool_fetch", "Fetch a spool file through OMQRSF/fetch.", "OMQRSF", "/fetch"],
    ["tdoms_analysis_impact", "Fetch impact analysis through OMQRIA/ref-style endpoint. Use path for dynamic object path.", "OMQRIA", "", "GET"],
    ["tdoms_analysis_dependency_graph", "Fetch dependency graph data through OMQRIA/ref-style endpoint. Use path for dynamic object path.", "OMQRIA", "", "GET"],
    ["tdoms_dashboard_execute", "Execute a dashboard query through OMRDASH/dashboard/execute/query.", "OMRDASH", "/dashboard/execute/query"],
    ["tdoms_kanban_boards", "Query TD/OMS board-like data through OMRDBA/get with a caller-provided body.", "OMRDBA", "/get"],
    ["tdoms_kanban_cards", "Query TD/OMS card-like task data through OMRDBA/get with a caller-provided body.", "OMRDBA", "/get"]
  ];

  for (const [name, description, service, path, method] of readEndpointTools) {
    registerEndpointTool(server, {
      name,
      description,
      service,
      path,
      store,
      clientFactory,
      confirm: false,
      allowPathOverride: service === "OMQRIA",
      method
    });
  }

  registerAliasTool(server, "tdoms_transfer_select_targets", "Discover valid TD/OMS transfer targets through OMQRTO/select using the documented transfer schema. This is the first step for checkout, promote, copy, or move.", {
    connectionId,
    action: z.enum(["Checkout", "Promote", "Copy", "Move"]).default("Checkout"),
    application: applicationCode.describe("TD/OMS application code. OMQRTO calls this field application, not applicationCode."),
    taskNumber,
    fromEnvironment: z.string().default(" ").describe("Environment to transfer from, such as *PRD, UAT, *ACC, or blank to let TD/OMS resolve defaults."),
    objectList: z.array(transferObject).default([]).describe("Objects to select. Leave empty to select all eligible task objects.")
  }, async (input) => {
    const body = compact({
      action: input.action,
      taskNumber: input.taskNumber,
      application: input.application,
      fromEnvironment: input.fromEnvironment,
      objectList: input.objectList
    });
    const response = await tdomsPost(store, input.connectionId, "OMQRTO", "/select", body, clientFactory);
    return result({ ok: true, response, body, next: "Choose a target from response.targets, then call tdoms_transfer_prepare with fromEnvironment, toEnvironment, and the same objects." });
  });

  registerAliasTool(server, "tdoms_transfer_prepare", "Prepare a TD/OMS transfer through OMQRTO/prepare after selecting a target. Requires confirm: true.", {
    connectionId,
    action: z.enum(["Copy", "Move"]).default("Copy").describe("Use Copy for normal checkout/promote style transfers unless TD/OMS specifically requires Move."),
    application: applicationCode.describe("TD/OMS application code. OMQRTO calls this field application, not applicationCode."),
    taskNumber,
    fromEnvironment: z.string().describe("Source environment chosen from tdoms_transfer_select_targets."),
    toEnvironment: z.string().describe("Target environment chosen from tdoms_transfer_select_targets."),
    objects: z.array(transferObject).default([]).describe("Objects to transfer. Leave empty for task-level transfer."),
    targetSubEnvironments: z.array(z.number()).default([]),
    confirmation: z.boolean().default(true).describe("TD/OMS pre-transfer confirmation flag."),
    confirm
  }, async (input) => {
    requireConfirmation(input.confirm, "prepare TD/OMS transfer");
    const body = compact({
      action: input.action,
      application: input.application,
      taskNumber: input.taskNumber,
      fromEnvironment: input.fromEnvironment,
      toEnvironment: input.toEnvironment,
      objects: input.objects,
      targetSubEnvironments: input.targetSubEnvironments,
      confirmation: input.confirmation
    });
    const response = await tdomsPost(store, input.connectionId, "OMQRTO", "/prepare", body, clientFactory);
    return result({ ok: true, response, body, next: "If prepare returns a transferNumber, call tdoms_transfer_execute_number. If it returns warnings/conflicts, inspect them before executing." });
  });

  registerAliasTool(server, "tdoms_transfer_execute_number", "Execute a prepared TD/OMS transfer through OMQRTO/execute using a transferNumber. Requires confirm: true.", {
    connectionId,
    transferNumber: z.string().max(20),
    schedules: z.array(z.record(z.string(), z.unknown())).default([]),
    confirm
  }, async (input) => {
    requireConfirmation(input.confirm, "execute TD/OMS transfer");
    const body = compact({
      transferNumber: input.transferNumber,
      schedules: input.schedules
    });
    const response = await tdomsPost(store, input.connectionId, "OMQRTO", "/execute", body, clientFactory);
    return result({ ok: true, response, body, next: "Call tdoms_transfer_progress_number with the transferNumber or returned job to monitor completion." });
  });

  registerAliasTool(server, "tdoms_transfer_progress_number", "Check TD/OMS transfer progress through OMQRTO/progress using a transferNumber and optional job object.", {
    connectionId,
    transferNumber: z.string().max(20).optional(),
    job: z.record(z.string(), z.unknown()).optional()
  }, async (input) => {
    const body = compact({
      transferNumber: input.transferNumber,
      job: input.job
    });
    const response = await tdomsPost(store, input.connectionId, "OMQRTO", "/progress", body, clientFactory);
    return result({ ok: true, response, body });
  });

  registerAliasTool(server, "tdoms_new_object_location", "Get TD/OMS new-object location/template defaults through OMQRNO/location. Use this before creating a new object so the exact environment/template values match the site.", {
    connectionId,
    applicationCode,
    task: taskNumber.describe("TD/OMS task/fix number. OMQRNO calls this field task, not taskNumber or fixNumber."),
    environmentCode,
    objectType: z.string().describe("Object type for the new object, such as *PGM, *FILE, *MODULE, or *SRVPGM."),
    objectAttribute: z.string().describe("Object attribute for the new object, such as RPGLE, SQLRPGLE, PF, or LF.")
  }, async (input) => {
    const response = await tdomsPost(store, input.connectionId, "OMQRNO", "/location", {
      applicationCode: input.applicationCode,
      environmentCode: input.environmentCode,
      task: input.task,
      objectType: input.objectType,
      objectAttribute: input.objectAttribute
    }, clientFactory);
    return result({ ok: true, response });
  });

  registerAliasTool(server, "tdoms_new_object_create", "Create a new TD/OMS object through OMQRNO/add with the documented lower-camel field names. Requires confirm: true.", {
    connectionId,
    applicationCode,
    task: taskNumber.describe("TD/OMS task/fix number. OMQRNO/add requires task, not fixNumber or taskNumber."),
    environmentCode,
    copyObject: z.enum(["0", "1"]).default("0").describe("Use 1 when creating by copying a template object; otherwise 0."),
    template,
    newObjectTemplate,
    newObject: z.string().max(128).describe("New object name, such as DEMOSRC."),
    newObjectLibrary: z.string().max(128).describe("Target object library."),
    newObjectType: z.string().describe("New object type, such as *PGM, *FILE, *MODULE, or *SRVPGM."),
    newDetail: z.string().default("").describe("Object detail/member. Usually blank for a new program object."),
    newDescription: z.string().default("").describe("New object description."),
    newAttribute: z.string().describe("New object attribute, such as RPGLE or SQLRPGLE."),
    newSourceFile: z.string().optional().describe("Source file for source-backed objects, such as QRPGLESRC."),
    newSourceLibrary: z.string().optional().describe("Source library for source-backed objects."),
    newSourceMember: z.string().optional().describe("Source member for source-backed objects."),
    newSourceAttribute: z.string().optional().describe("Source member attribute, such as RPGLE or SQLRPGLE."),
    temporaryOrVirtualObject: z.enum(["0", "1"]).default("0").describe("Use 1 only for temporary/virtual TD/OMS objects."),
    confirm
  }, async (input) => {
    requireConfirmation(input.confirm, "create TD/OMS new object");
    const body = compact({
      applicationCode: input.applicationCode,
      task: input.task,
      environmentCode: input.environmentCode,
      copyObject: input.copyObject ?? "0",
      template: input.template,
      newObjectTemplate: input.newObjectTemplate,
      newObject: input.newObject,
      newObjectLibrary: input.newObjectLibrary,
      newObjectType: input.newObjectType,
      newDetail: input.newDetail ?? "",
      newDescription: input.newDescription ?? "",
      newAttribute: input.newAttribute,
      newSourceFile: input.newSourceFile,
      newSourceLibrary: input.newSourceLibrary,
      newSourceMember: input.newSourceMember,
      newSourceAttribute: input.newSourceAttribute,
      temporaryOrVirtualObject: input.temporaryOrVirtualObject ?? "0"
    });
    const response = await tdomsPost(store, input.connectionId, "OMQRNO", "/add", body, clientFactory);
    return result({ ok: true, response, body });
  });

  registerAliasTool(server, "tdoms_new_source_member_create", "Create a new source member/detail in an existing source file through OMQRNO/add. Requires confirm: true.", {
    connectionId,
    applicationCode,
    task: taskNumber.describe("TD/OMS task/fix number. OMQRNO/add requires task, not fixNumber or taskNumber."),
    environmentCode,
    newObject: z.string().max(128).describe("Source file object, such as QRPGLESRC or QSQLTABLES."),
    newObjectLibrary: z.string().max(128).describe("Library that contains the source file."),
    newDetail: z.string().max(128).describe("New source member/detail name."),
    newDescription: z.string().default("").describe("New member description."),
    newAttribute: z.string().describe("New member/source attribute, such as RPGLE or SQL."),
    newObjectTemplate,
    newObjectType: z.string().default("*FILE").describe("Official OMQRNO new-member shape uses *FILE for the source file object."),
    copyObject: z.enum(["0", "1"]).default("0"),
    temporaryOrVirtualObject: z.enum(["0", "1"]).default("0"),
    confirm
  }, async (input) => {
    requireConfirmation(input.confirm, "create TD/OMS new source member");
    const body = compact({
      applicationCode: input.applicationCode,
      task: input.task,
      environmentCode: input.environmentCode,
      copyObject: input.copyObject ?? "0",
      newObjectTemplate: input.newObjectTemplate,
      newObject: input.newObject,
      newObjectLibrary: input.newObjectLibrary,
      newObjectType: input.newObjectType ?? "*FILE",
      newDetail: input.newDetail,
      newDescription: input.newDescription ?? "",
      newAttribute: input.newAttribute,
      temporaryOrVirtualObject: input.temporaryOrVirtualObject ?? "0"
    });
    const response = await tdomsPost(store, input.connectionId, "OMQRNO", "/add", body, clientFactory);
    return result({ ok: true, response, body });
  });

  const mutatingEndpointTools = [
    ["tdoms_source_save_object", "Save object source through OMRSRC/object/save.", "OMRSRC", "/object/save"],
    ["tdoms_ifs_save", "Save IFS source through OMRSRC/object/save with IFS fields in the body.", "OMRSRC", "/object/save"],
    ["tdoms_transfer_select", "Run transfer select through OMQRTO/select.", "OMQRTO", "/select"],
    ["tdoms_transfer_prepare", "Run transfer prepare through OMQRTO/prepare.", "OMQRTO", "/prepare"],
    ["tdoms_transfer_execute", "Run transfer execute through OMQRTO/execute.", "OMQRTO", "/execute"],
    ["tdoms_transfer_cancel", "Cancel transfer through OMQRTO/cancel.", "OMQRTO", "/cancel"],
    ["tdoms_transfer_hold_job", "Execute transfer with hold-job semantics using a caller-provided body.", "OMQRTO", "/execute"],
    ["tdoms_transfer_move", "Run move transfer using caller-provided transfer body.", "OMQRTO", "/execute"],
    ["tdoms_transfer_copy", "Run copy transfer using caller-provided transfer body.", "OMQRTO", "/execute"],
    ["tdoms_spool_delete", "Delete a spool file through OMQRSF/delete.", "OMQRSF", "/delete"],
    ["tdoms_remote_job_close", "Close a remote job through OMQRRJ/close.", "OMQRRJ", "/close"],
    ["tdoms_remote_job_reopen", "Reopen a remote job through OMQRRJ/reopen.", "OMQRRJ", "/reopen"],
    ["tdoms_kanban_move_card", "Move a Kanban card by changing task/request status using a caller-provided body.", "OMQRTA", "/status"]
  ];

  for (const [name, description, service, path] of mutatingEndpointTools) {
    registerEndpointTool(server, { name, description, service, path, store, clientFactory, confirm: true });
  }

  registerAliasTool(server, "tdoms_source_read_object", "Read object/member source through OMRSRC/object/get.", {
    connectionId,
    applicationCode: applicationCode.optional(),
    taskNumber: taskNumber.optional(),
    path: z.string().optional(),
    objectCode,
    objectType,
    objectLibrary,
    memberCode,
    pageNumber: z.number().int().min(0).default(1)
  }, async (input) => {
    const response = await tdomsPost(store, input.connectionId, "OMRSRC", "/object/get", compact({
      applicationCode: input.applicationCode,
      taskNumber: input.taskNumber,
      path: input.path,
      objectCode: input.objectCode,
      objectType: input.objectType,
      objectLibrary: input.objectLibrary,
      memberCode: input.memberCode,
      pageNumber: input.pageNumber
    }), clientFactory);
    return result({ ok: true, response, sourceTextUtf8: decodeBase64Text(response?.sourceCode), sourceCodeBase64: response?.sourceCode });
  });

  registerAliasTool(server, "tdoms_ifs_search", "Search IFS objects/components through OMXObjectExtended.", {
    connectionId,
    applicationCode: applicationCode.optional(),
    ifsPath: z.string().optional(),
    pageNumber: z.number().int().min(1).default(1),
    recordsPerPage: z.number().int().min(1).max(50).default(25)
  }, async (input) => {
    const fieldSelections = compactArray([
      input.applicationCode && { field: "applicationCode", value: input.applicationCode, operator: "EQ" },
      { field: "objectClass", value: "B", operator: "EQ" },
      input.ifsPath && { field: "iFSObjectCode", value: input.ifsPath, operator: "CONTAINS", ignoreCase: true }
    ]);
    const response = await queryDatabase(store, input.connectionId, {
      table: "OMXObjectExtended",
      fieldSelections,
      pageNumber: input.pageNumber,
      recordsPerPage: input.recordsPerPage,
      returnTotalRecords: true
    }, clientFactory);
    return result({ ok: true, response });
  });

  registerAliasTool(server, "tdoms_ifs_read", "Read IFS source through OMRSRC/object/get using path/IFS body fields.", {
    connectionId,
    body: rawBody
  }, async (input) => {
    const response = await tdomsPost(store, input.connectionId, "OMRSRC", "/object/get", input.body, clientFactory);
    return result({ ok: true, response, sourceTextUtf8: decodeBase64Text(response?.sourceCode), sourceCodeBase64: response?.sourceCode });
  });

  for (const name of ["tdoms_source_history", "tdoms_source_revision", "tdoms_source_includes", "tdoms_component_editor_get"]) {
    registerDatabaseTool(server, {
      name,
      description: `${name.replaceAll("_", " ")} through TD/OMS database discovery tables.`,
      table: name === "tdoms_component_editor_get" ? "OMXObjectExtended" : "OMXObjectTransferHistory",
      store,
      clientFactory
    });
  }

  registerDiffTool(server, "tdoms_source_diff", "Diff two plain source strings.");
  registerSourceCompareTool(server, "tdoms_source_compare", "Compare two TD/OMS source bodies by reading both and returning a simple line diff.", store, clientFactory);
  registerSourceCompareTool(server, "tdoms_source_compare_production", "Compare current source to a production/revision source body.", store, clientFactory);
  registerSourceCompareTool(server, "tdoms_source_compare_revision", "Compare current source to another revision source body.", store, clientFactory);
  registerSourceCompareTool(server, "tdoms_ifs_compare", "Compare two IFS source bodies.", store, clientFactory);

  for (const name of ["tdoms_compile_task", "tdoms_compile_solution", "tdoms_compile_object"]) {
    registerAliasTool(server, name, "Queue and optionally release compile work. Requires confirm: true.", {
      connectionId,
      applicationCode,
      taskNumber,
      objectCode,
      objectType,
      objectLibrary,
      detail: z.string().optional(),
      release: z.boolean().default(false),
      confirm
    }, async (input) => {
      requireConfirmation(input.confirm, name);
      const queue = await tdomsPost(store, input.connectionId, "OMQRSQ", "/queue", compileQueueBody(input), clientFactory);
      const releaseResponse = input.release
        ? await tdomsPost(store, input.connectionId, "OMQRSQ", "/release", compileQueueBody(input), clientFactory)
        : undefined;
      return result({ ok: true, queue, release: releaseResponse });
    });
  }

  registerAliasTool(server, "tdoms_compile_and_check", "Queue, release, and optionally parse IBM i compile events for a TD/OMS object in one workflow. Use this instead of asking the user to manually paste compile errors. Requires confirm: true.", {
    connectionId,
    applicationCode,
    taskNumber,
    objectCode,
    objectType,
    objectLibrary,
    detail: z.string().optional(),
    parseEvents: z.boolean().default(true),
    eventLibrary: z.string().optional().describe("Library that contains the EVENTF/source member. Defaults to objectLibrary."),
    eventMember: z.string().optional().describe("Member name for compile event parsing. Defaults to detail, then objectCode."),
    confirm
  }, async (input) => {
    requireConfirmation(input.confirm, "compile and check TD/OMS object");
    const body = compileQueueBody(input);
    const queue = await tdomsPost(store, input.connectionId, "OMQRSQ", "/queue", body, clientFactory);
    const release = await tdomsPost(store, input.connectionId, "OMQRSQ", "/release", body, clientFactory);
    const eventLibraryValue = input.eventLibrary || input.objectLibrary;
    const eventMemberValue = input.eventMember || input.detail || input.objectCode;
    const events = input.parseEvents && eventLibraryValue && eventMemberValue
      ? await tdomsPost(store, input.connectionId, "OMQREV", "/parseEvent", { library: eventLibraryValue, memberName: eventMemberValue }, clientFactory)
      : undefined;
    return result({
      ok: true,
      queue,
      release,
      events,
      eventSummary: summarizeCompileEvents(events),
      body
    });
  });

  for (const name of ["tdoms_checkout_task", "tdoms_checkout_solution", "tdoms_checkout_object", "tdoms_promote_task", "tdoms_promote_solution", "tdoms_promote_object"]) {
    registerTransferWorkflowTool(server, name, store, clientFactory);
  }
}

function registerAliasTool(server, name, description, inputSchema, handler) {
  if (server._registeredTools[name]) {
    return;
  }
  server.registerTool(name, { description, inputSchema }, handler);
}

function registerDatabaseTool(server, { name, description, table, returnFields, store, clientFactory }) {
  registerAliasTool(server, name, description, {
    connectionId: z.string(),
    applicationCode: z.string().optional(),
    taskNumber: z.string().optional(),
    requestNumber: z.string().optional(),
    programmer: z.string().optional(),
    status: z.string().optional().describe("TD/OMS task/fix status, if known."),
    text: z.string().optional().describe("Text to search in the short task description."),
    pathCode: z.string().optional(),
    objectCode: z.string().optional(),
    objectType: z.string().optional(),
    objectLibrary: z.string().optional(),
    memberCode: z.string().optional(),
    table: z.string().optional().describe("Override the default TD/OMS table/view for this tool."),
    returnFields: z.array(z.string()).optional(),
    fieldSelections: z.array(fieldSelectionSchema).optional(),
    whereClause: z.string().optional(),
    sortFields: z.array(sortFieldSchema).optional(),
    pageNumber: z.number().int().min(0).default(1),
    recordsPerPage: z.number().int().min(1).max(50).default(25),
    returnTotalRecords: z.boolean().default(true)
  }, async (input) => {
    const response = await queryDatabase(store, input.connectionId, {
      table: input.table || table,
      returnFields: input.returnFields || returnFields,
      fieldSelections: input.fieldSelections || commonFieldSelections(input),
      whereClause: input.whereClause,
      sortFields: input.sortFields,
      pageNumber: input.pageNumber ?? 1,
      recordsPerPage: input.recordsPerPage ?? 25,
      returnTotalRecords: input.returnTotalRecords ?? true
    }, clientFactory);
    return result({ ok: true, table: input.table || table, response });
  });
}

function registerEndpointTool(server, { name, description, service, path, store, clientFactory, confirm, allowPathOverride = false, method = "POST" }) {
  const inputSchema = {
    connectionId: z.string(),
    body: z.record(z.string(), z.unknown()).default({}),
    confirm: z.boolean().optional()
  };
  if (allowPathOverride) {
    inputSchema.path = z.string().optional().describe("Dynamic endpoint path, such as /ref/{object}/{type}/{library}/{member}.");
  }

  registerAliasTool(server, name, description, inputSchema, async (input) => {
    if (confirm) {
      requireConfirmation(input.confirm, name);
    }
    const endpointPath = allowPathOverride ? input.path : path;
    if (!endpointPath) {
      throw new Error(`Provide path for ${name}.`);
    }
    const response = method === "GET"
      ? await tdomsGet(store, input.connectionId, service, endpointPath, clientFactory)
      : await tdomsPost(store, input.connectionId, service, endpointPath, input.body || {}, clientFactory);
    return result({ ok: true, response });
  });
}

function registerDiffTool(server, name, description) {
  registerAliasTool(server, name, description, {
    left: z.string(),
    right: z.string(),
    leftLabel: z.string().default("left"),
    rightLabel: z.string().default("right")
  }, async (input) => result({ ok: true, diff: simpleLineDiff(input.left, input.right, input.leftLabel, input.rightLabel) }));
}

function registerSourceCompareTool(server, name, description, store, clientFactory) {
  registerAliasTool(server, name, description, {
    connectionId: z.string(),
    leftBody: z.record(z.string(), z.unknown()).describe("Body for OMRSRC/object/get for the left/current source."),
    rightBody: z.record(z.string(), z.unknown()).describe("Body for OMRSRC/object/get for the right/production/revision source."),
    leftLabel: z.string().default("left"),
    rightLabel: z.string().default("right")
  }, async (input) => {
    const left = await tdomsPost(store, input.connectionId, "OMRSRC", "/object/get", input.leftBody, clientFactory);
    const right = await tdomsPost(store, input.connectionId, "OMRSRC", "/object/get", input.rightBody, clientFactory);
    const leftText = decodeBase64Text(left?.sourceCode);
    const rightText = decodeBase64Text(right?.sourceCode);
    return result({
      ok: true,
      left,
      right,
      diff: simpleLineDiff(leftText, rightText, input.leftLabel, input.rightLabel)
    });
  });
}

function registerTransferWorkflowTool(server, name, store, clientFactory) {
  registerAliasTool(server, name, "Run a transfer workflow with select, prepare, execute, and optional progress polling. Requires confirm: true.", {
    connectionId: z.string(),
    selectBody: z.record(z.string(), z.unknown()).optional(),
    prepareBody: z.record(z.string(), z.unknown()).optional(),
    executeBody: z.record(z.string(), z.unknown()).optional(),
    progressBody: z.record(z.string(), z.unknown()).optional(),
    runSelect: z.boolean().default(true),
    runPrepare: z.boolean().default(true),
    runExecute: z.boolean().default(true),
    getProgress: z.boolean().default(true),
    confirm: z.boolean().optional()
  }, async (input) => {
    requireConfirmation(input.confirm, name);
    const steps = {};
    if (input.runSelect) {
      steps.select = await tdomsPost(store, input.connectionId, "OMQRTO", "/select", input.selectBody || {}, clientFactory);
    }
    if (input.runPrepare) {
      steps.prepare = await tdomsPost(store, input.connectionId, "OMQRTO", "/prepare", input.prepareBody || input.selectBody || {}, clientFactory);
    }
    if (input.runExecute) {
      steps.execute = await tdomsPost(store, input.connectionId, "OMQRTO", "/execute", input.executeBody || input.prepareBody || input.selectBody || {}, clientFactory);
    }
    if (input.getProgress) {
      steps.progress = await tdomsPost(store, input.connectionId, "OMQRTO", "/progress", input.progressBody || input.executeBody || {}, clientFactory);
    }
    return result({ ok: true, steps });
  });
}

async function safeQuery(store, connectionId, input, clientFactory) {
  try {
    return await queryDatabase(store, connectionId, input, clientFactory);
  } catch (error) {
    return { ok: false, error: String(error?.message || error), table: input.table };
  }
}

function taskQuery(table, input) {
  return {
    table,
    fieldSelections: [
      { field: "applicationCode", value: input.applicationCode, operator: "EQ" },
      { field: "fixNumber", value: input.taskNumber, operator: "EQ" }
    ],
    pageNumber: 1,
    recordsPerPage: 50,
    returnTotalRecords: true
  };
}

function requestQuery(table, input) {
  return {
    table,
    fieldSelections: [
      { field: "applicationCode", value: input.applicationCode, operator: "EQ" },
      { field: "requestNumber", value: input.requestNumber, operator: "EQ" }
    ],
    pageNumber: 1,
    recordsPerPage: 50,
    returnTotalRecords: true
  };
}

function objectQuery(table, input) {
  return {
    table,
    fieldSelections: commonFieldSelections(input),
    pageNumber: 1,
    recordsPerPage: 50,
    returnTotalRecords: true
  };
}

function commonFieldSelections(input) {
  return compactArray([
    input.applicationCode && { field: "applicationCode", value: input.applicationCode, operator: "EQ" },
    input.taskNumber && { field: "fixNumber", value: input.taskNumber, operator: "EQ" },
    input.requestNumber && { field: "requestNumber", value: input.requestNumber, operator: "EQ" },
    input.programmer && { field: "programmer", value: input.programmer, operator: "EQ" },
    input.status && { field: "fixStatus", value: input.status, operator: "EQ" },
    input.text && { field: "shortFixDescription", value: input.text, operator: "CONTAINS", ignoreCase: true },
    input.pathCode && { field: "pathCode", value: input.pathCode, operator: "EQ" },
    input.objectCode && { field: "objectCode", value: input.objectCode, operator: "EQ" },
    input.objectType && { field: "objectType", value: input.objectType, operator: "EQ" },
    input.objectLibrary && { field: "objectLibrary", value: input.objectLibrary, operator: "EQ" },
    input.memberCode && { field: "memberCode", value: input.memberCode, operator: "EQ" }
  ]);
}

function simpleLineDiff(leftText, rightText, leftLabel = "left", rightLabel = "right") {
  const left = String(leftText || "").split(/\r?\n/);
  const right = String(rightText || "").split(/\r?\n/);
  const max = Math.max(left.length, right.length);
  const lines = [`--- ${leftLabel}`, `+++ ${rightLabel}`];
  for (let index = 0; index < max; index += 1) {
    const leftLine = left[index];
    const rightLine = right[index];
    if (leftLine === rightLine) {
      continue;
    }
    lines.push(`@@ line ${index + 1} @@`);
    if (leftLine !== undefined) {
      lines.push(`- ${leftLine}`);
    }
    if (rightLine !== undefined) {
      lines.push(`+ ${rightLine}`);
    }
  }
  return lines.join("\n");
}

function replaceLiteral(sourceText, searchText, replacementText, { occurrence = 1, replaceAll = false } = {}) {
  if (!searchText) {
    throw new Error("searchText cannot be empty.");
  }

  if (replaceAll) {
    const replacements = sourceText.split(searchText).length - 1;
    if (replacements === 0) {
      throw new Error("searchText was not found in source.");
    }
    return {
      text: sourceText.split(searchText).join(replacementText),
      replacements
    };
  }

  let fromIndex = 0;
  let foundAt = -1;
  for (let index = 0; index < occurrence; index += 1) {
    foundAt = sourceText.indexOf(searchText, fromIndex);
    if (foundAt === -1) {
      throw new Error(`searchText occurrence ${occurrence} was not found in source.`);
    }
    fromIndex = foundAt + searchText.length;
  }

  return {
    text: `${sourceText.slice(0, foundAt)}${replacementText}${sourceText.slice(foundAt + searchText.length)}`,
    replacements: 1
  };
}

function splitTextByUtf8Bytes(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return [text];
  }

  const chunks = [];
  let current = "";
  for (const char of text) {
    const candidate = current + char;
    if (current && Buffer.byteLength(candidate, "utf8") > maxBytes) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current || chunks.length === 0) {
    chunks.push(current);
  }
  return chunks;
}

function compileQueueBody(input, processingArray = { clearAll: false }) {
  return compact({
    applicationCode: input.applicationCode,
    taskNumber: input.taskNumber,
    objectCode: input.objectCode || "",
    objectType: input.objectType || "",
    objectLibrary: input.objectLibrary || "",
    detail: input.detail || "",
    processingArray
  });
}

function summarizeCompileEvents(events) {
  const messages = collectMessageObjects(events);
  const severityCounts = {};
  const errorLike = [];

  for (const message of messages) {
    const severity = message.severity ?? message.messageSeverity ?? message.type ?? message.Type;
    const normalizedSeverity = severity === undefined ? "unknown" : String(severity);
    severityCounts[normalizedSeverity] = (severityCounts[normalizedSeverity] || 0) + 1;

    const numericSeverity = Number(normalizedSeverity);
    const messageText = message.messageText || message.text || message.Text || message.message || "";
    if (Number.isFinite(numericSeverity) && numericSeverity >= 30) {
      errorLike.push({
        severity: numericSeverity,
        line: message.lineNumber ?? message.lineNr ?? message["Line Nr."] ?? message.line,
        messageId: message.messageId ?? message.messageID ?? message["Message ID"],
        text: messageText,
        sourceFile: message.sourceFile ?? message.SourceFile
      });
    }
  }

  return {
    totalMessages: messages.length,
    severityCounts,
    hasErrors: errorLike.length > 0,
    errors: errorLike.slice(0, 20)
  };
}

function collectMessageObjects(value, output = []) {
  if (!value) {
    return output;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectMessageObjects(entry, output);
    }
    return output;
  }

  if (typeof value !== "object") {
    return output;
  }

  const keys = Object.keys(value);
  if (keys.some((key) => /message|severity|sourcefile|line/i.test(key))) {
    output.push(value);
  }

  for (const entry of Object.values(value)) {
    collectMessageObjects(entry, output);
  }

  return output;
}

function requireConfirmation(confirm, action) {
  if (confirm !== true) {
    throw new Error(`Refusing to ${action}. Re-run with confirm: true after the user approves the action.`);
  }
}

function isUnauthorized(error) {
  return /\b401\b/.test(String(error?.message || error));
}

function decodeBase64Text(value) {
  if (!value) {
    return "";
  }

  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function compactArray(values) {
  return values.filter(Boolean);
}

function compact(value) {
  if (Array.isArray(value)) {
    return value.map(compact);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, compact(entry)])
  );
}

function result(structuredContent) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent
  };
}
