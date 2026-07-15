---
name: tdoms-mcp-routing
description: Use TD/OMS change management through the standalone TD/OMS MCP or Octo MCP tools. Trigger for tasks, requests, source, objects, checkout, promote, transfer, compile, branches, connection lists, logs, spool files, conflicts, labels, and other TD/OMS workflows, especially when an agent incorrectly asks for Octo sign-in or a programmer ID.
---

# TD/OMS MCP Routing

Prefer the standalone TD/OMS MCP when available. It works independently of the Octo VS Code UI.

## Standalone Core Flow

1. Call `tdoms_get_current_context`. Let it select the only connection and derive the TD/OMS programmer ID from the saved profile.
2. Call `tdoms_list_capabilities` when the requested workflow or required choices are unclear.
3. Call `tdoms_discover_options` before choosing application, environment, programmer, path, reason, target, object, template, conflict resolution, or any site-specific value.
4. Use `tdoms_discover_options` for structured task, request, component, source, queue, compile, history, log, spool, tracker, dependency, and dashboard reads.
5. For changes, call `tdoms_plan_workflow` with the exact context, selections, and `optionSelections` for values returned by discovery. Show the user its action, target, endpoint/body preview, warnings, and blockers.
6. Call `tdoms_execute_workflow` with the returned `planId` and `confirm: true` only after the user approves that exact preview.
7. Call `tdoms_get_workflow_status` for asynchronous work.

Never guess a value when discovery returns no choices or `supported: false`. Ask one concise question instead.

For "my tasks," use option set `tasks` without supplying a programmer. The MCP uses the saved TD/OMS username automatically. Set `context.allUsers: true` only when the user requests tasks for everyone.

## Mutation Rules

- Read current state before planning.
- Treat source saves, checkout, promote, transfer, compile, complete, delete, process, queue, release, close, and configuration changes as mutations.
- Never set `confirm: true` without explicit approval of the current plan.
- Stop when TD/OMS reports warnings, locks, conflicts, authority failures, or changed state. Summarize the result and replan if needed.
- Never ask the user to paste TD/OMS credentials into chat.

## Full Profile

When `TDOMS_MCP_PROFILE=full`, prefer a specific named read tool when it is clearer than generic discovery. Named mutation tools still require explicit approval and `confirm: true`.

Use typed transfer tools in this sequence: select targets, prepare, inspect warnings, execute, then monitor progress. Use typed source tools to read the latest source and last-change marker before saving. Use compile-and-check to retrieve diagnostics instead of asking the user to paste spool output.

## Octo MCP Fallback

If only the extension MCP is available:

- Use `OMS-Database-REST-API.getRecords` for reads and task lists.
- Use `TD-OMS-Task-API` only for task mutations.
- Use `TD-OMS-Branch-Service-API` for branch mutations.
- Treat `Octo-Views` and `Octo-Wizards` as UI launchers, not proof that an action completed.
- Do not require `Octo-User-Context` before direct TD/OMS reads.

If Octo user context says sign-in is required but a direct TD/OMS read succeeds, continue with the direct tool and report that the Octo UI context is stale. Retry programmer filters in uppercase before reporting that no tasks exist.
