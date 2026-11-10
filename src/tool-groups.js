// Tool groups keep the agent-facing tool list small. Every named tool belongs to
// exactly one group; agents browse groups with tdoms_list_tool_groups, read schemas
// with tdoms_describe_tools, and call any tool with tdoms_run_tool.

export const TOOL_GROUPS = Object.freeze([
  group("core", "Start here", "Context, saved defaults, option discovery, guarded workflow plans, app-ready views, and the tool catalog. Always loaded."),
  group("connection", "Connections and sign-in", "Saved connections, login, token refresh, Octo sign-in import, system and license info, user context."),
  group("tasks", "Tasks", "Search, read, create, change, complete, copy, ratify and link tasks; task comments and labels."),
  group("requests", "Requests", "Search, read, create, change, complete and link requests."),
  group("objects", "Objects and solutions", "Find and connect objects, solutions, components, connection lists, new objects, data areas, IFS objects and object templates."),
  group("source", "Source and IFS", "Check, read, save, patch and compare source members and IFS files."),
  group("build", "Build and spool", "Compile through the build queue, compile results and errors, compile overrides, spooled files."),
  group("transfer", "Transfer and branches", "Checkout, promote, transfer, branches, version conflicts, managed deployments and remote jobs."),
  group("insight", "History and analytics", "Logs, transfer history, dashboards, impact and dependency analysis, Kanban data, tracker records."),
  group("admin", "Administration and raw access", "Data dictionary, saved searches, user options, database queries, the raw REST escape hatch and IBM i data conversions.")
]);

export const TOOL_GROUP_IDS = TOOL_GROUPS.map((entry) => entry.id);

const CORE_TOOLS = new Set([
  "tdoms_list_connections",
  "tdoms_get_current_context",
  "tdoms_set_working_context",
  "tdoms_list_capabilities",
  "tdoms_discover_options",
  "tdoms_plan_workflow",
  "tdoms_execute_workflow",
  "tdoms_get_workflow_status",
  "tdoms_get_view",
  "tdoms_list_tool_groups",
  "tdoms_describe_tools",
  "tdoms_run_tool"
]);

// First match wins.
const RULES = [
  [/^tdoms_(connection_list_|object_template_|new_|fill_object_|data_area_|ifs_object_)/, "objects"],
  [/^tdoms_(connection_|login_connection$|get_system_info$|user_context$)/, "connection"],
  [/^tdoms_(task_|create_task$|search_tasks$|get_task$|comment_|label_|kanban_move_card$)/, "tasks"],
  [/^tdoms_request_/, "requests"],
  [/^tdoms_(object_|solution_|component_)/, "objects"],
  [/^tdoms_(read_source|save_source|patch_source|check_source|source_|ifs_)/, "source"],
  [/^tdoms_(compile_|parse_compile_events$|build_queue_|spool_)/, "build"],
  [/^tdoms_(transfer_|checkout_|promote_|branch_|version_conflict_|managed_deployment_|remote_job_)/, "transfer"],
  [/^tdoms_(log_|dashboard_|analysis_|kanban_|tracker_)/, "insight"],
  [/^tdoms_(admin_|query_database$|call_api$|user_option|ibmi_)/, "admin"]
];

export function groupForTool(name) {
  if (CORE_TOOLS.has(name)) return "core";
  for (const [pattern, id] of RULES) {
    if (pattern.test(name)) return id;
  }
  return undefined;
}

export function parseGroups(value) {
  const requested = (Array.isArray(value) ? value : String(value || "").split(","))
    .map((entry) => String(entry).trim().toLowerCase())
    .filter(Boolean);
  const unknown = requested.filter((entry) => entry !== "all" && !TOOL_GROUP_IDS.includes(entry));
  if (unknown.length > 0) {
    throw new Error(`Unknown TD/OMS MCP tool group: ${unknown.join(", ")}. Expected one of: ${TOOL_GROUP_IDS.join(", ")}, all.`);
  }
  return requested.includes("all") ? [...TOOL_GROUP_IDS] : [...new Set(["core", ...requested])];
}

function group(id, title, description) {
  return Object.freeze({ id, title, description });
}
