---
name: tdoms-mcp-routing
description: Operate TD/OMS change management through the standalone TD/OMS MCP or, when necessary, the Octo extension MCP. Use for developer workflows involving tasks, requests, objects, source, checkout, promote, transfer, compile, branches, solutions, connection lists, logs, spool files, revisions, conflicts, ratification, labels, trackers, remote jobs, or TD/OMS option discovery. Also use when choosing between standalone and Octo tools, diagnosing Octo sign-in or programmer-context failures, or explaining TD/OMS MCP capabilities and limits.
---

# TD/OMS MCP Routing

Use the standalone MCP as the primary automation surface. It talks to the configured TD/OMS REST server and does not control VS Code or require an Octo session.

## Load References Deliberately

- Read [references/workflow-playbooks.md](references/workflow-playbooks.md) before performing a domain workflow such as checkout, promote, source save, compile, completion, ratification, branch work, or conflict handling.
- Read [references/tool-and-extension-map.md](references/tool-and-extension-map.md) when selecting tools, comparing the standalone MCP with Octo, or checking whether a capability is core-only, full-profile, UI-only, or unsupported.
- Read [references/tdoms-domain-and-sources.md](references/tdoms-domain-and-sources.md) when terminology, lifecycle semantics, source authority, or version differences matter.

## Establish Runtime Context

1. Inspect the tools actually available in the current agent session. Runtime tool schemas override this skill if names or inputs differ.
2. Call `tdoms_list_connections`.
3. If exactly one connection exists, omit `connectionId` where the schema permits and call `tdoms_get_current_context`.
4. If several connections exist, the active connection saved in the working context is used. When none is saved, select only from the returned profiles, ask the user to choose when the request does not identify one, and save the choice with `tdoms_set_working_context`.
5. If no connection exists, check `tdoms_connection_octo_status` through `tdoms_run_tool`. When Octo is signed in on this machine, offer `tdoms_connection_import_octo`. Otherwise direct the user to `tdoms-mcp ui` or `tdoms-mcp login`. Never request a password, token, or certificate contents in chat.
6. Treat `user.programmerId` from current context as the default identity for "my" records. Do not ask for a programmer ID unless the user is reassigning work, selecting another programmer, or the server cannot derive one.
7. Once the user names the application or task they are working on, save it with `tdoms_set_working_context`. Later calls may then omit `connectionId`, and tools that require `applicationCode` or `taskNumber` fall back to the saved values and report them in `defaultsApplied`. Clear a value with `null` when the user moves on.

## Find Tools By Group

The tool list is grouped so that only the `core` group is loaded by default. Do not guess tool names.

1. Call `tdoms_list_tool_groups` to see the groups: `core`, `connection`, `tasks`, `requests`, `objects`, `source`, `build`, `transfer`, `insight`, and `admin`.
2. Call `tdoms_describe_tools` with a `group` (or `search`) for a compact list of names and descriptions.
3. Call `tdoms_describe_tools` with `tools: [names]` to read input schemas for only the tools about to be used.
4. Call the tool directly when its group is loaded; otherwise call `tdoms_run_tool` with the tool name and `arguments`. Confirmation rules are unchanged: mutations still need `confirm: true` inside `arguments`.

## Show Views To The User

Use `tdoms_get_view` for Work Management, Kanban, analytics, dependency graph, build queue, and transfer history. Each response carries a `summary` to relay in plain language and a `widget` (`board`, `table`, `stats`, or `graph`) that a host app can render. Relay the summary and the few rows that matter; do not paste the widget JSON to the user. Card and row `actions` are suggested follow-up tool calls, not completed work.

## Choose the Surface

- Prefer the `core` tools for portable agent workflows and small tool budgets.
- Use `tdoms_discover_options` for both choices and structured reads that replace Octo views.
- Use `tdoms_plan_workflow` and `tdoms_execute_workflow` whenever the requested mutation appears in `tdoms_list_capabilities`.
- Use a named tool from another group when no core capability exists or when a typed tool gives safer inputs, richer diagnostics, or a complete read workflow.
- Use Octo tools only when the user explicitly needs an Octo panel/editor or when the standalone MCP lacks the required TD/OMS or Octo-cloud operation.
- Do not use `tdoms_call_api` until named and planned tools have been ruled out and the endpoint and body are documented for the connected TD/OMS version.

## Read Workflow

1. Resolve context.
2. Call `tdoms_list_capabilities` if the workflow is unclear.
3. Call `tdoms_discover_options` with the relevant `optionSet`, narrow context, and pagination.
4. Treat returned `value` fields as machine inputs and `label` fields as display text.
5. Honor `enabled`, `source.authoritative`, `warnings`, and `supported`.
6. Follow pagination rather than assuming the first page is complete.
7. Verify the returned application, task, environment, object, library, member, or path before reporting results.

For "my tasks," discover `tasks` without a programmer filter. The MCP applies the saved TD/OMS username in uppercase. Set `context.allUsers: true` only when the user requests a cross-user search.

## Planned Mutation Workflow

Follow this sequence for every supported core mutation:

1. Read the current state.
2. Discover every site-specific choice required by the capability.
3. Call `tdoms_plan_workflow` with:
   - the exact capability `workflow` id;
   - stable identifiers in `context`;
   - mutation fields in `selections`;
   - each chosen discovery value in `optionSelections`, keyed by option-set name.
4. Stop on blockers. Never invent a missing option or silently replace an unavailable choice.
5. Present the plan title, target, endpoint/body preview, warnings, and expiry to the user.
6. Obtain explicit approval for that exact preview.
7. Call `tdoms_execute_workflow` with the matching `planId` and `confirm: true`.
8. Call `tdoms_get_workflow_status` and/or a domain read to verify the postcondition.

Plans expire after ten minutes, execute once, and are rejected if state or selected options change. Re-discover and replan instead of trying to force a stale plan.

## Named-Tool Mutation Workflow

Some named-tool actions, including task creation, source save, compile, connection-list processing, and several branch or request actions, are not represented by a core plan id.

1. Read current state and discover choices first.
2. Prefer a typed named tool over an `*_action` tool or raw API call.
3. Construct the exact arguments but do not call the mutation yet.
4. Show the user the action, target, important fields, and likely effect.
5. Call the named tool with `confirm: true` only after explicit approval.
6. Re-read TD/OMS to verify the result. A successful transport response is not sufficient proof of the final lifecycle state.

## Safety And Failure Rules

- Treat create, change, save, connect, disconnect, process, queue, release, checkout, promote, transfer, complete, ratify, resolve, close, schedule, delete, purge, and configuration operations as mutations.
- Do not equate `OMQRTO/select` with a completed transfer; it discovers eligible targets and may initialize preparatory server state.
- Stop on authority errors, locks, pre-transfer checks, warnings requiring a decision, version conflicts, stale source markers, compile failures, or changed task state.
- Preserve server casing and exact codes. Retry a programmer lookup in uppercase only when identity-derived lookup returned no records.
- Do not broaden to all users, all applications, or unfiltered database queries without a user need.
- Do not claim that an Octo wizard or view launcher completed work. It only opened UI.
- If Octo user context reports sign-in required but standalone reads succeed, continue through the standalone MCP and describe the Octo session as separate or stale.
- Save source with `tdoms_save_source_checked` and pass the `lastChangeDate` from the last read as `expectedLastChangeDate`. Use `forceSave: true` only when the user accepts overwriting other edits. When a save reports `failedPage`, run `tdoms_check_source` before retrying.
- Never expose saved connection metadata beyond what the task requires. Never print passwords, JWTs, master keys, CA contents, local credential files, or personal filesystem paths.

## Finish With Evidence

Report the identifiers used, the observed final state, warnings that remain, and any follow-up state check needed. Distinguish clearly between planned, submitted, queued, running, completed, rejected, and unsupported work.
