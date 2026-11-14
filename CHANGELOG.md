# Changelog

## 0.10.4

- Mark every tool with MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) from one table in `src/tool-annotations.js`, so clients that review tool calls can let reads through. Registration fails for a tool missing from the table.
- Add `tdoms_run_read_tool`, which runs only read-only catalog tools and is itself marked read-only. `tdoms_describe_tools` reports `readOnly` for each tool. Tool behaviour and `confirm: true` rules are unchanged.

## 0.10.3

- Fix disconnecting solutions from a task. `disconnect-solutions` and `tdoms_solution_disconnect` posted a flat body that TD/OMS read as an unregistered IFS object. They now read the task's solution rows and post the nested `OMQRSO/multiDisconnect` request, disconnect only by default, with deleting the object and source as an explicit, clearly previewed choice. Solutions that are not on the task are refused before posting.
- Fix `move-solutions`, `change-solution-type`, and the connect, lock, unlock, move, and change solution tools, which had the same flat-body fault. They now build the nested requests (`/multiMove`, `/multiChange`, `/multiLock`, `/multiUnlock`, `/connect`) and take typed inputs. `tdoms_solution_action` rejects flat bodies.

## 0.10.2

- Fix linking a task to a tracker issue. `link-task-to-issue`, `link-issue-to-task`, `unlink-task-from-issue`, `tdoms_task_link_ticket`, and `tdoms_task_unlink_ticket` now post the TD/OMS link request fields (`freeFormatProductId`, `urlToItem`, `urlToProduct`, `universalUniqueId`, `disableIndicator`, `remoteIssueInformation`) instead of the read-side names, which TD/OMS rejected with "The product Id may not be blank." The plan defaults the product id and issue URL form from the application's existing links, checks for an existing link first, and refuses to post with a blank product id or issue URL.
- Fix `tdoms_task_tickets`, `tdoms_task_backlinks`, `tdoms_task_requests`, `tdoms_task_details`, and the `trackerLinks` option set, which queried a table or task field that TD/OMS does not have. They now read `OMXRequestTaskLink` by `taskNumber`.

## 0.10.1

- Fix the command entry so npm keeps the `tdoms-mcp` command.
