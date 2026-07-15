# Tool And Extension Map

## Contents

- Runtime profiles
- Core interface
- Discovery option sets
- Core capability registry
- Full-profile families
- Octo extension comparison
- View replacements
- Intentional exclusions

## Runtime Profiles

The standalone server has two profiles:

- `core`: 7 agent-neutral tools. Prefer this for broad client compatibility and limited tool budgets.
- `full`: 226 named tools in the audited release. Prefer this for typed direct actions, specialized reads, and developer diagnostics.

Counts are a release snapshot, not an API contract. Inspect the live MCP tool list and schemas before acting.

## Core Interface

| Tool | Purpose |
| --- | --- |
| `tdoms_list_connections` | List saved local connection profiles without returning secrets. |
| `tdoms_get_current_context` | Resolve connection, TD/OMS username/programmer identity, applications, and environments. |
| `tdoms_list_capabilities` | Return workflow ids, option sets, required context, mode, support, and Octo wizard mapping. |
| `tdoms_discover_options` | Return normalized choices or structured records from TD/OMS. |
| `tdoms_plan_workflow` | Create a read-only mutation preview and ten-minute plan. |
| `tdoms_execute_workflow` | Revalidate and execute one approved plan. |
| `tdoms_get_workflow_status` | Read plan state and execution result. |

## Discovery Option Sets

Discovery exposes 40 option sets. Use the exact runtime enum if it differs.

- Identity and configuration: `applications`, `environments`, `programmers`, `userClasses`.
- Task metadata: `taskStatuses`, `taskTypes`, `releases`, `priorities`, `completionReasons`, `ratificationReasons`.
- Change structure: `branchesPaths`, `taskObjects`, `solutions`, `solutionTypes`, `memberAttributes`, `labels`.
- Transfer and build: `transferTargets`, `subEnvironments`, `compileOverrides`, `conflicts`, `schedules`, `remoteJobs`.
- Creation and history: `objectTemplates`, `objectLocations`, `revisions`, `userOptions`, `trackerLinks`.
- Structured view reads: `tasks`, `requests`, `components`, `connectionLists`, `buildQueue`, `compileResults`, `transferHistory`, `logs`, `spoolFiles`, `trackerRecords`, `source`, `dependencies`, `dashboards`.

`OMSINFO/system`, `OMQRTO/select`, and `OMQRNO/location` results are authoritative for their returned choices. Several database-derived metadata lists are marked non-authoritative because they infer valid values from existing records. Respect `source.authoritative` in every response.

## Core Capability Registry

The registry mirrors the 28 audited Octo wizards as structured workflows. It contains 24 supported mutations, 3 supported read-only capabilities, and 1 Octo-only unsupported capability.

| Workflow id | Mode | Required option sets or note |
| --- | --- | --- |
| `change-member-attribute` | Mutation | `memberAttributes` |
| `change-programmer` | Mutation | `programmers`, `userClasses` |
| `change-solution-type` | Mutation | `solutions`, `solutionTypes` |
| `change-task-transfer-path` | Mutation | `branchesPaths` |
| `compile-override` | Mutation | `compileOverrides`, `taskObjects` |
| `complete-task` | Mutation | `completionReasons` |
| `delete-objects` | Mutation | `taskObjects` |
| `disconnect-solutions` | Mutation | `solutions` |
| `display-message` | Read-only | Return message data; no window is opened. |
| `edit-branch` | Mutation | `branchesPaths` |
| `fill-object-file` | Mutation | `taskObjects` |
| `manage-label` | Mutation | `labels` |
| `link-issue-to-task` | Mutation | `trackerLinks` |
| `link-task-to-issue` | Mutation | `trackerLinks` |
| `move-solutions` | Mutation | `solutions`, `branchesPaths` |
| `new-object` | Mutation | `objectTemplates`, `objectLocations` |
| `new-task-branch` | Mutation | `branchesPaths` |
| `close-remote-job` | Mutation | `remoteJobs`, `completionReasons` |
| `reopen-remote-job` | Mutation | `remoteJobs` |
| `schedule-remote-job` | Mutation | `remoteJobs`, `schedules` |
| `revision-compare` | Read-only | `revisions` |
| `solution-conflict` | Read-only | Discover `solutions` and `conflicts`; resolution is site-specific. |
| `task-ratification` | Mutation | `ratificationReasons`, `programmers` |
| `tracker-server-manager` | Unsupported | Octo configuration; no known TD/OMS REST endpoint. |
| `transfer` | Mutation | `taskObjects`, `transferTargets`, `subEnvironments` |
| `unlink-task-from-issue` | Mutation | `trackerLinks` |
| `execute-user-option` | Mutation | `userOptions` |
| `resolve-version-conflict` | Mutation | `conflicts` |

The registry is not the complete full-profile capability list. For example, task creation, request creation, source saves, compile queue work, branch stash/restore/purge, and connection-list processing use full named tools.

## Full-Profile Families

Prefer the most specific tool whose schema matches the operation.

- Context and connection: `tdoms_connection_*`, `tdoms_get_system_info`.
- Tasks: `tdoms_task_*`, `tdoms_create_task`, `tdoms_search_tasks`.
- Requests: `tdoms_request_*`.
- Solutions and objects: `tdoms_solution_*`, `tdoms_object_*`, `tdoms_component_*`.
- Source and IFS: `tdoms_read_source_all`, `tdoms_save_source_all`, `tdoms_patch_source_literal`, `tdoms_source_*`, `tdoms_ifs_*`.
- New objects: `tdoms_new_object_location`, `tdoms_new_object_create`, `tdoms_new_source_member_create`.
- Transfer: `tdoms_transfer_select_targets`, `tdoms_transfer_prepare`, `tdoms_transfer_execute_number`, `tdoms_transfer_progress_number`, plus typed checkout/promote tools.
- Compile: `tdoms_compile_and_check`, `tdoms_compile_*`, `tdoms_build_queue_*`, `tdoms_compile_override_*`.
- Branches: `tdoms_branch_*`.
- Connection lists: `tdoms_connection_list_*`.
- History and diagnostics: `tdoms_transfer_history`, `tdoms_log_*`, `tdoms_spool_*`, `tdoms_remote_job_*`.
- Governance and metadata: `tdoms_comment_*`, `tdoms_label_*`, `tdoms_user_option_*`, `tdoms_version_conflict_*`.
- Analysis and views: `tdoms_analysis_*`, `tdoms_dashboard_*`, `tdoms_kanban_*`, `tdoms_tracker_*`.
- Advanced: `tdoms_query_database`, administration tools, family `*_action` tools, and `tdoms_call_api`.

Specific typed tools should outrank family action tools. Family action tools should outrank `tdoms_call_api`.

## Octo Extension Comparison

The extension audit was performed against Octo TD/OMS `1.5.1260701`. Its 95 tools were grouped as follows:

| Extension group | Count | Standalone relationship |
| --- | ---: | --- |
| Branch API | 7 | Covered by full `tdoms_branch_*`; selected branch workflows also have core plans. |
| Task API | 11 | Covered by full `tdoms_task_*`; selected task workflows also have core plans. |
| Database REST API | 1 | Covered by discovery and full `tdoms_query_database`. |
| Octo Views | 20 | Replaced by structured reads; no VS Code panel is opened. |
| Octo Wizards | 28 | Mapped into the core capability registry; tracker server manager remains Octo-only. |
| Octo local/context utilities | 28 | Mostly intentionally excluded; agents already provide generic text, crypto, and encoding utilities. |

The standalone MCP adds many REST operations that the extension exposes only indirectly through UI services or internal clients. It also adds option normalization, automatic connection-derived identity, token refresh, read-only planning, plan expiry, state revalidation, confirmation gates, and post-operation status reads.

Do not describe this as visual parity. It provides TD/OMS data and change-management parity where documented, not VS Code panels, editors, decorations, command-palette behavior, Octo mail, or Octo session management.

## View Replacements

| Octo view intent | Core discovery or full named read |
| --- | --- |
| Work Management | `tasks`, `requests`; `tdoms_task_search`, `tdoms_request_search` |
| Branches | `branchesPaths`; `tdoms_branch_search`, `tdoms_branch_get` |
| Task Editor | `tdoms_task_details` or task-related option sets |
| Component Editor / Components | `components`, `taskObjects`; object/component detail tools |
| Solution Editor | `solutions`; `tdoms_solution_details` |
| Source Editor | `source`; `tdoms_read_source_all` |
| Spool source/files | `spoolFiles`; spool list/fetch tools |
| Build Queue | `buildQueue`; build-queue tools |
| Analytics | `dashboards`; dashboard and analysis tools |
| Connection List | `connectionLists`; connection-list tools |
| Dependency Graph | `dependencies`; analysis tools |
| Transfer History | `transferHistory`; transfer-history tools |
| Log History / Details | `logs`; log tools |
| Tracker | `trackerRecords`; tracker tools |
| Compile Result | `compileResults`; compile-result/error tools |
| Remote Job Monitor | `remoteJobs`; remote-job tools |

## Intentional Exclusions

- Octo mail notification is not a TD/OMS change-management operation.
- Generic hashing, UUID, Base64, JSON, URL, time, byte-size, EBCDIC, and packed-decimal utilities are not duplicated.
- Tracker server administration remains Octo-only without a documented TD/OMS endpoint.
- UI-only navigation and editor state are not controlled.
- Site-specific behavior without an authoritative API choice is returned as unsupported instead of guessed.
