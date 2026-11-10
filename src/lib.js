// Programmatic entry point for apps that embed TD/OMS MCP instead of launching
// the CLI: build a server for any transport, or reuse the pieces directly.

export { createMcpServer, startMcpServer } from "./mcp-server.js";
export { createHttpApp, startHttpServer, resolveHttpToken } from "./http-server.js";
export { ConnectionStore } from "./connection-store.js";
export { TdomsClient, summarizeSystemInfo } from "./tdoms-client.js";
export { TOOL_GROUPS, TOOL_GROUP_IDS, groupForTool } from "./tool-groups.js";
export { CAPABILITIES, OPTION_SETS, getCapability } from "./capability-registry.js";
export { WORKING_CONTEXT_FIELDS, readWorkingContext, updateWorkingContext } from "./working-context.js";
export { readOctoSession, importOctoConnection } from "./octo-session.js";
export {
  VIEW_IDS,
  VIEW_DESCRIPTIONS,
  buildTaskTableView,
  buildKanbanView,
  buildAnalyticsView,
  buildDependencyGraphView,
  buildRecordTableView
} from "./views.js";
