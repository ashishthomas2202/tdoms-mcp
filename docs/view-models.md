# View Models

`tdoms_get_view` returns TD/OMS views as data that any UI can render. The same builders are exported from the package (`buildKanbanView`, `buildTaskTableView`, `buildAnalyticsView`, `buildDependencyGraphView`, `buildRecordTableView`) for apps that fetch records themselves.

## Envelope

Every view has the same outer shape:

```json
{
  "ok": true,
  "view": "kanban",
  "title": "Kanban",
  "summary": "3 tasks in 2 status columns: Open 2, Completed 1.",
  "counts": { "shown": 3, "total": 3, "columns": 2 },
  "widget": { "type": "board" },
  "context": { "applicationCode": "DEMOAPP", "programmer": "DEVUSER" },
  "source": { "connectionId": "…", "kind": "OMRDBA/OMXFix" },
  "generatedAt": "2026-01-01T00:00:00.000Z"
}
```

- `summary` is plain language for an agent to relay or an app to show as a caption.
- `widget.type` selects the renderer. Unknown types should fall back to showing `summary`.
- `context` records the filters that produced the view, including defaults that were applied.
- `actions` on cards and rows are suggested follow-up tool calls: `{ "label", "tool", "arguments" }`. They describe what a click could do; nothing has been executed.

## Widgets

### board

Used by `kanban`.

```json
{
  "type": "board",
  "groupedBy": "fixStatus",
  "columns": [
    {
      "id": "Open",
      "title": "Open",
      "count": 2,
      "cards": [
        {
          "id": "DEMOAPP/T1001",
          "title": "T1001",
          "subtitle": "Short task description",
          "badges": ["DEVUSER"],
          "fields": { "applicationCode": "DEMOAPP", "taskNumber": "T1001", "programmer": "DEVUSER", "priority": "", "pathCode": "" },
          "actions": [{ "label": "Open task", "tool": "tdoms_task_details", "arguments": { "applicationCode": "DEMOAPP", "taskNumber": "T1001" } }]
        }
      ]
    }
  ]
}
```

Columns are task statuses in the order they first appear. The board is built from task records; it does not read an Octo Kanban provider.

### table

Used by `workManagement`, `buildQueue`, and `transferHistory`.

```json
{
  "type": "table",
  "columns": [{ "key": "taskNumber", "label": "Task" }],
  "rows": [{ "id": "DEMOAPP/T1001", "cells": { "taskNumber": "T1001" }, "actions": [] }]
}
```

### stats

Used by `analytics`.

```json
{
  "type": "stats",
  "metrics": [{ "id": "tasks", "label": "Tasks analysed", "value": 3 }],
  "breakdowns": [{ "id": "status", "label": "Tasks by status", "items": [{ "label": "Open", "value": 2 }] }]
}
```

Each breakdown is ready for a bar or pie chart. Figures are computed from the task records that were read, up to `maxRecords`.

### graph

Used by `dependencyGraph`.

```json
{
  "type": "graph",
  "nodes": [{ "id": "DEMOLIB/DEMOPGM/*PGM/DEMOPGM", "label": "DEMOPGM", "type": "*PGM", "root": true }],
  "edges": [{ "from": "DEMOLIB/DEMOPGM/*PGM/DEMOPGM", "to": "DEMOLIB/DEMOFILE/*FILE", "relation": "uses" }]
}
```

`relation` is the name of the section of the TD/OMS impact response the object was found under.

## Embedding

```js
import { createMcpServer, ConnectionStore, buildKanbanView } from "tdoms-mcp";

const server = createMcpServer({ store: new ConnectionStore(), groups: "tasks,source" });
await server.connect(transport); // any MCP transport: stdio, in-memory, Streamable HTTP
```

An app that cannot launch a local process can run `tdoms-mcp http` and connect to `http://127.0.0.1:3738/mcp` with the bearer token.
