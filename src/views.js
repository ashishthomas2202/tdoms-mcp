// View models turn TD/OMS records into UI-neutral widgets. An app renders the
// `widget`; an agent reads `summary` to the user. No function here touches the
// network, so an embedding app can reuse them on data it fetched itself.
//
// Widget types:
//   board  { columns: [{ id, title, count, cards: [{ id, title, subtitle, badges, fields, actions }] }] }
//   table  { columns: [{ key, label }], rows: [{ id, cells, actions }] }
//   stats  { metrics: [{ id, label, value }], breakdowns: [{ id, label, items: [{ label, value }] }] }
//   graph  { nodes: [{ id, label, type, root }], edges: [{ from, to, relation }] }
// `actions` are suggested follow-up tool calls: { label, tool, arguments }.

export const VIEW_IDS = Object.freeze(["workManagement", "kanban", "analytics", "dependencyGraph", "buildQueue", "transferHistory"]);

export const VIEW_DESCRIPTIONS = Object.freeze({
  workManagement: "Task list as a table. Defaults to the current programmer's tasks.",
  kanban: "Tasks as a board with one column per task status.",
  analytics: "Task counts by status, programmer, type and release.",
  dependencyGraph: "Objects that reference or are referenced by one object. Needs objectCode, objectType, objectLibrary and memberCode.",
  buildQueue: "Build queue and compile status rows as a table.",
  transferHistory: "Transfer history rows as a table."
});

export function buildTaskTableView(records, { context = {}, total } = {}) {
  const rows = records.map((record) => ({
    id: taskId(record),
    cells: {
      applicationCode: text(record.applicationCode),
      taskNumber: text(record.fixNumber),
      description: text(record.shortFixDescription),
      status: text(record.fixStatus),
      programmer: text(record.programmer),
      release: text(record.release),
      pathCode: text(record.pathCode)
    },
    actions: taskActions(record)
  }));
  const byStatus = countBy(records, (record) => text(record.fixStatus) || "(no status)");
  return view("workManagement", "Work Management", {
    type: "table",
    columns: columns(["taskNumber", "Task"], ["description", "Description"], ["status", "Status"], ["programmer", "Programmer"], ["applicationCode", "Application"], ["release", "Release"], ["pathCode", "Path"]),
    rows
  }, context, {
    counts: { shown: rows.length, total: total ?? rows.length },
    summary: rows.length === 0
      ? "No tasks match."
      : `${countLabel(rows.length, total, "task")}: ${listCounts(byStatus)}.`
  });
}

export function buildKanbanView(records, { context = {}, total, statusOrder = [] } = {}) {
  const byStatus = new Map(statusOrder.map((status) => [status, []]));
  for (const record of records) {
    const status = text(record.fixStatus) || "(no status)";
    if (!byStatus.has(status)) byStatus.set(status, []);
    byStatus.get(status).push(record);
  }
  const boardColumns = [...byStatus.entries()].map(([status, items]) => ({
    id: status,
    title: status,
    count: items.length,
    cards: items.map((record) => ({
      id: taskId(record),
      title: text(record.fixNumber),
      subtitle: text(record.shortFixDescription),
      badges: [text(record.programmer), text(record.fixType), text(record.release)].filter(Boolean),
      fields: {
        applicationCode: text(record.applicationCode),
        taskNumber: text(record.fixNumber),
        programmer: text(record.programmer),
        priority: text(record.priorityNumeric),
        pathCode: text(record.pathCode)
      },
      actions: taskActions(record)
    }))
  }));
  return view("kanban", "Kanban", { type: "board", groupedBy: "fixStatus", columns: boardColumns }, context, {
    counts: { shown: records.length, total: total ?? records.length, columns: boardColumns.length },
    summary: records.length === 0
      ? "No tasks match, so the board is empty."
      : `${countLabel(records.length, total, "task")} in ${boardColumns.length} status column${boardColumns.length === 1 ? "" : "s"}: ${boardColumns.map((column) => `${column.title} ${column.count}`).join(", ")}.`
  });
}

export function buildAnalyticsView(records, { context = {}, total } = {}) {
  const breakdown = (id, label, pick) => ({
    id,
    label,
    items: [...countBy(records, (record) => text(pick(record)) || "(none)").entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([itemLabel, value]) => ({ label: itemLabel, value }))
  });
  const breakdowns = [
    breakdown("status", "Tasks by status", (record) => record.fixStatus),
    breakdown("programmer", "Tasks by programmer", (record) => record.programmer),
    breakdown("type", "Tasks by type", (record) => record.fixType),
    breakdown("release", "Tasks by release", (record) => record.release)
  ];
  const top = (id) => breakdowns.find((entry) => entry.id === id).items[0];
  return view("analytics", "Task Analytics", {
    type: "stats",
    metrics: [
      { id: "tasks", label: "Tasks analysed", value: records.length },
      { id: "statuses", label: "Statuses in use", value: breakdowns[0].items.length },
      { id: "programmers", label: "Programmers", value: breakdowns[1].items.length }
    ],
    breakdowns
  }, context, {
    counts: { shown: records.length, total: total ?? records.length },
    summary: records.length === 0
      ? "No tasks match, so there is nothing to analyse."
      : `${countLabel(records.length, total, "task")} analysed. Most common status: ${top("status").label} (${top("status").value}). Busiest programmer: ${top("programmer").label} (${top("programmer").value}).`
  });
}

export function buildDependencyGraphView(response, { context = {} } = {}) {
  const rootId = objectId(context) || "root";
  const nodes = new Map([[rootId, { id: rootId, label: text(context.objectCode) || "Selected object", type: text(context.objectType), root: true }]]);
  const edges = [];
  walkDependencies(response?.reportResult ?? response, rootId, undefined, nodes, edges, new Set());
  const related = nodes.size - 1;
  return view("dependencyGraph", "Dependency Graph", { type: "graph", nodes: [...nodes.values()], edges }, context, {
    counts: { nodes: nodes.size, edges: edges.length },
    summary: related === 0
      ? `No related objects were returned for ${nodes.get(rootId).label}.`
      : `${nodes.get(rootId).label} is linked to ${related} object${related === 1 ? "" : "s"} through ${edges.length} reference${edges.length === 1 ? "" : "s"}.`
  });
}

export function buildRecordTableView(viewId, title, records, { context = {}, total, fields, noun = "row", statusField, statusFallback = "(no status)" } = {}) {
  const rows = records.map((record, index) => ({
    id: String(index + 1),
    cells: Object.fromEntries(fields.map(([key]) => [key, text(record[key])]))
  }));
  const statusText = statusField && rows.length > 0 ? `: ${listCounts(countBy(records, (record) => text(record[statusField]) || statusFallback))}` : "";
  return view(viewId, title, { type: "table", columns: columns(...fields), rows }, context, {
    counts: { shown: rows.length, total: total ?? rows.length },
    summary: rows.length === 0 ? `No ${noun}s match.` : `${countLabel(rows.length, total, noun)}${statusText}.`
  });
}

function walkDependencies(value, parentId, relation, nodes, edges, seen) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) walkDependencies(entry, parentId, relation, nodes, edges, seen);
    return;
  }
  let currentId = parentId;
  if (text(value.objectCode) || text(value.refLink)) {
    const id = objectId(value) || text(value.refLink);
    if (!nodes.has(id)) {
      nodes.set(id, { id, label: text(value.objectCode) || id, type: text(value.objectType), root: false });
    }
    if (id !== parentId && !edges.some((edge) => edge.from === parentId && edge.to === id && edge.relation === relation)) {
      edges.push({ from: parentId, to: id, relation: relation || text(value.relationType) || "references" });
    }
    currentId = id;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (entry && typeof entry === "object") {
      walkDependencies(entry, currentId, Array.isArray(entry) || !text(entry.objectCode) ? key : relation, nodes, edges, seen);
    }
  }
}

function view(id, title, widget, context, { counts, summary }) {
  return { view: id, title, summary, counts, widget, context };
}

function taskActions(record) {
  const applicationCode = text(record.applicationCode);
  const taskNumber = text(record.fixNumber);
  if (!applicationCode || !taskNumber) return [];
  return [
    { label: "Open task", tool: "tdoms_task_details", arguments: { applicationCode, taskNumber } },
    { label: "Work on this task", tool: "tdoms_set_working_context", arguments: { applicationCode, taskNumber } }
  ];
}

function taskId(record) {
  return [text(record.applicationCode), text(record.fixNumber)].filter(Boolean).join("/");
}

function objectId(value) {
  const parts = [value.objectLibrary, value.objectCode, value.objectType, value.memberCode].map(text);
  return parts.some(Boolean) ? parts.filter(Boolean).join("/") : "";
}

function columns(...entries) {
  return entries.map(([key, label]) => ({ key, label }));
}

function countBy(records, pick) {
  const counts = new Map();
  for (const record of records) {
    const key = pick(record);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function listCounts(counts) {
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([label, value]) => `${value} ${label}`).join(", ");
}

function countLabel(shown, total, noun) {
  const plural = shown === 1 ? noun : `${noun}s`;
  return Number.isFinite(total) && total > shown ? `Showing ${shown} of ${total} ${noun}s` : `${shown} ${plural}`;
}

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}
