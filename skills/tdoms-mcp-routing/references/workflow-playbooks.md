# TD/OMS Workflow Playbooks

## Contents

- Common preflight
- Find my work
- Task and request lifecycle
- Source changes
- New objects and members
- Checkout, promote, and transfer
- Compile and diagnostics
- Solutions, components, and connection lists
- Branches and paths
- Completion and ratification
- Revisions and conflicts
- Logs, spool files, and remote jobs
- Labels, comments, user options, and trackers
- Analytics, dependencies, and Kanban
- Failure recovery

## Common Preflight

For every playbook:

1. List connections and resolve current context.
2. Keep application, task/request number, environment, path, object, library, type, and member as separate fields.
3. Discover site values instead of using examples from documentation.
4. Read current state before a mutation.
5. Use a core plan when a matching capability id exists.
6. Otherwise preview a full named mutation and obtain explicit approval before `confirm: true`.
7. Verify the postcondition with a fresh read.

## Find My Work

Core:

1. Call `tdoms_get_current_context`.
2. Discover `tasks` with application/status/search filters as needed. Do not pass programmer for "my tasks."
3. Page until the requested scope is satisfied.
4. For one task, discover `taskObjects`, `solutions`, `buildQueue`, `compileResults`, `transferHistory`, `logs`, and `trackerRecords` only as needed.

Full:

- Use `tdoms_task_search` for lists and `tdoms_task_details` for an aggregate view.
- Use `tdoms_task_objects`, `tdoms_task_requests`, `tdoms_task_tickets`, `tdoms_task_comments`, and similar reads for focused follow-up.

If no task is found, retry the derived programmer in uppercase before reporting no records. Do not broaden to all programmers automatically.

## Task And Request Lifecycle

Creating a task or request uses named tools from the `tasks` and `requests` groups, called directly when the group is loaded or through `tdoms_run_tool`:

1. Discover applications, programmers, task types, releases, priorities, paths, or request metadata required by the live tool schema.
2. Build a preview for `tdoms_create_task` or `tdoms_request_create`.
3. Obtain approval, call with `confirm: true`, then fetch the created identifier.

For supported changes such as programmer, path, completion, ratification, and ticket links, prefer the matching core capability. Use full `tdoms_task_*` and `tdoms_request_*` for status, copy, delete, request connections, and other lifecycle actions absent from the core registry.

Never infer that a task is ready to complete from its description. Read objects, build state, transfer state, conflicts, and site-required reasons first.

## Source Changes

1. Resolve the exact object, type, library, member/detail, application, and task.
2. Call `tdoms_check_source` to confirm the target is editable and see its page count, then read all pages with core `source` discovery or `tdoms_read_source_all`.
3. Preserve the returned last-change marker and encoding metadata.
4. Make the smallest requested edit locally.
5. Show a concise diff and target identity.
6. Obtain approval.
7. Prefer `tdoms_patch_source_literal` for a narrow literal replacement or `tdoms_save_source_checked` for a complete save. Pass the change marker from step 3 as `expectedLastChangeDate`; the save is refused when the source changed in the meantime.
8. If the save reports `failedPage`, treat the source as unconfirmed: run `tdoms_check_source`, then re-read before retrying.
9. Re-read source and compare the saved text.

Use `tdoms_ifs_read`, `tdoms_ifs_save`, and `tdoms_ifs_compare` for IFS content. Stop on stale markers or object locks and re-read before retrying.

## New Objects And Members

1. Discover application, environment, task, object type, and attribute.
2. Call core discovery for `objectLocations`/`objectTemplates` or full `tdoms_new_object_location`.
3. Use only returned libraries, source files, templates, and defaults.
4. For a new object, use the core `new-object` plan or `tdoms_new_object_create`. Use `tdoms_data_area_create` for a data area and `tdoms_ifs_object_create` for an IFS file.
5. For a member in an existing source file, use `tdoms_new_source_member_create`.
6. Verify the object/component record and source location after creation.

Keep TD/OMS field distinctions exact: the new-object API uses `task`, `newObject`, `newObjectLibrary`, `newObjectType`, and `newAttribute`. Do not substitute similarly named task/object fields from other APIs.

## Checkout, Promote, And Transfer

Never jump directly to execute.

Core planned flow:

1. Discover `taskObjects`.
2. Discover `transferTargets` and `subEnvironments` with action, application, task, source environment, and object list.
3. Plan workflow `transfer` with exact returned options.
4. Review source, target, objects, action, warnings, and preview.
5. Approve and execute the plan.
6. Read workflow status and transfer history.

Full typed flow:

1. Call `tdoms_transfer_select_targets` with `Checkout`, `Promote`, `Copy`, or `Move` as appropriate.
2. Select a returned target; do not type a remembered environment code.
3. Preview and approve `tdoms_transfer_prepare`.
4. Stop if preparation reports pre-transfer checks, conflicts, missing dependencies, or warnings requiring a decision.
5. Approve `tdoms_transfer_execute_number` using the returned transfer number.
6. Poll `tdoms_transfer_progress_number` and verify transfer history plus task/object state.

The convenience tools `tdoms_checkout_*` and `tdoms_promote_*` can run several phases. Use them only when their complete request bodies have already been discovered and approved. A queued or running transfer is not completed.

## Compile And Diagnostics

1. Read the task object and source state.
2. Check existing build queue and compile results.
3. Preview the exact object/task/solution compile target.
4. Obtain approval.
5. Prefer `tdoms_compile_and_check` for an object because it queues, releases, and parses compile events in one workflow.
6. Use `tdoms_compile_task`, `tdoms_compile_solution`, or `tdoms_compile_object` when broader queue control is needed.
7. Read build queue, compile result, parsed events, logs, and spool files until a terminal state appears.

Do not report success from queue acceptance alone. Report severity, source line when available, message id/text, object, member, and final build status. Compile overrides require separate discovery and approval.

## Solutions, Components, And Connection Lists

- Discover `solutions` and `taskObjects` before moving, changing, disconnecting, or deleting them.
- Use core plans for change solution type, disconnect solutions, move solutions, change member attribute, delete objects, and fill object file.
- Use full solution/object tools for connect, lock/unlock, relations, close, refill, and operations not in the core registry.

For a connection list:

1. Read list and entries.
2. Preview additions/changes/deletions.
3. Obtain approval for each mutation scope.
4. Re-read the list.
5. Treat `process` as a separate mutation, obtain approval, then verify resulting task/object state and logs.

## Branches And Paths

- Discover `branchesPaths` and current task path first.
- Use `new-task-branch`, `edit-branch`, or `change-task-transfer-path` core plans when applicable.
- Use full `tdoms_branch_*` tools for search/get, status recalculation, delete, stash, restore, and purge.
- Treat purge as irreversible and require especially clear target confirmation.
- Verify affected tasks/solutions and branch status after mutation.

## Completion And Ratification

Completion:

1. Read task details, objects, compile state, conflicts, and transfer state.
2. Discover `completionReasons`.
3. Plan `complete-task` with the exact reason and task identifiers.
4. Obtain approval, execute, and re-read task status.

Ratification:

1. Read pending ratification state and authorized choices.
2. Discover `ratificationReasons` and programmers when required.
3. Plan `task-ratification` with the explicit decision and comment fields required by the live schema.
4. Never infer approval or rejection from conversational sentiment.
5. Obtain explicit approval for the recorded decision, execute, and verify ratification history/status.

## Revisions And Conflicts

- Discover `revisions`, then use `revision-compare` or full source compare tools for read-only review.
- Discover `conflicts` and read object/version context before resolving.
- `solution-conflict` is discovery-only because resolution behavior may be site-specific.
- Use `resolve-version-conflict` only when the server returns a documented resolution choice and the user approves the exact object/version decision.
- Re-read conflicts and source history after execution.

## Logs, Spool Files, And Remote Jobs

- Use `logs` discovery or full log-history/message tools; preserve job and message identifiers.
- Use `spoolFiles` discovery or spool list/fetch for diagnostics. Deletion is a separate confirmed mutation.
- Discover `remoteJobs` before close, reopen, or schedule operations.
- Use the matching core plan where available, otherwise the full typed tool.
- Verify remote-job state after the call; asynchronous acceptance is not completion.

## Labels, Comments, User Options, And Trackers

- Discover labels before applying, changing, removing, or deleting them.
- Read existing comments before add/reply/change/delete operations.
- Discover `userOptions`; treat execution as arbitrary site-configured behavior and show the selected option and target before approval.
- Discover tracker links/records before link or unlink.
- Tracker server administration is Octo-only unless a site supplies a documented TD/OMS endpoint.

## Analytics, Dependencies, And Kanban

- Use `dashboards` or full dashboard tools for warnings such as missing source and problematic transfers.
- Use `dependencies` or full impact/dependency tools before high-impact changes.
- Use Kanban reads for visualization data. Moving a card changes task/request state and is a mutation requiring approval.
- Treat inferred dashboard or database data as evidence, not as authorization for a mutation.

## Failure Recovery

| Failure | Response |
| --- | --- |
| No connection | Ask the user to configure and test one in `tdoms-mcp ui`. |
| Multiple connections | Return profile choices and ask for the intended system. |
| Authentication/token failure | Let automatic refresh run; if login still fails, ask the user to update the saved connection in the UI. |
| `supported: false` | Report the warning and required context; do not guess. |
| Empty options | Check context, casing, filters, and pagination; then ask one focused question. |
| Plan expired/stale | Re-read, re-discover, create a new plan, and obtain approval again. |
| Authority failure | Stop and report the TD/OMS operation and target that lacked authority. |
| Lock/version conflict | Read lock/conflict/source history; do not overwrite. |
| Transfer warning | Stop between prepare and execute until the user resolves or approves a documented choice. |
| Compile failure | Fetch parsed events, logs, and spool output; do not mark work complete. |
| Octo sign-in error | Use standalone context if available; Octo and standalone authentication are separate. |
