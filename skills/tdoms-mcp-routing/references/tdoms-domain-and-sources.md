# TD/OMS Domain And Sources

## Contents

- Source authority
- Domain model
- Change lifecycle
- Version and site variability
- Public references

## Source Authority

Use evidence in this order:

1. Live MCP tool names, schemas, and responses.
2. Choices returned by the connected TD/OMS server.
3. The standalone MCP capability registry and typed tool implementation for the installed package version.
4. Documentation supplied by the user's TD/OMS administrators for that server version and site policy.
5. Official public Remain Software product, marketplace, and release documentation for conceptual context.
6. This skill's audited extension comparison as a versioned compatibility snapshot.

Do not derive REST payloads, reason codes, environment codes, or authorization decisions from marketing pages. Public documentation establishes concepts; live schemas and server responses establish executable values.

## Domain Model

- Application: the TD/OMS-managed software scope. Applications define environment and workflow context.
- Environment: a lifecycle location such as development, test, acceptance, emergency, or production. Actual codes and paths are site-defined.
- Request: a higher-level change or business request that may connect to tasks.
- Task/fix: the principal unit of assigned change work, lifecycle status, programmer ownership, and transfer control.
- Solution: a task-connected change record for an object/component.
- Object/component: a managed deployable or source-backed artifact. IBM i identity commonly includes object name, type, library, and optional member/detail.
- Source: editable content associated with a managed object or IFS item. Saves require current identity and concurrency markers.
- Branch/path: site-defined routing or isolation metadata controlling where work moves.
- Transfer: the controlled movement of task objects/solutions between lifecycle environments.
- Checkout: a transfer that brings eligible managed content into a development context.
- Promote: a transfer that advances completed work toward a later environment.
- Build queue/compile: asynchronous object creation work with queue state, compile results, event records, logs, and spool files.
- Ratification: an approval/rejection gate used for peer review, user acceptance, management approval, or another configured quality gate.
- Revision/conflict: archived or competing versions used for compare, history, and controlled resolution.

These relationships are stable concepts, but field names, statuses, reasons, transfer paths, and policy gates are configured per site.

## Change Lifecycle

A robust agent workflow follows:

1. Identify the application and current task/request.
2. Read the assigned programmer, status, path, environment, objects, and relevant history.
3. Discover allowed choices from the connected server.
4. Connect or create the intended object/solution under the task.
5. Read and edit source with concurrency protection.
6. Compile and inspect terminal diagnostics.
7. Review dependencies, conflicts, labels/comments, and required approvals.
8. Prepare checkout/promote/transfer and inspect pre-transfer checks.
9. Execute only after explicit approval.
10. Monitor asynchronous work and verify final TD/OMS state.
11. Complete or ratify only when site policy and observed state allow it.

This is a decision framework, not a universal site policy. The connected server remains authoritative.

## Version And Site Variability

- TD/OMS and Octo evolve independently and expose different capabilities by release.
- Octo views and wizards are UI affordances; their visible fields may be populated by multiple TD/OMS APIs and database views.
- Some option lists are authoritative configuration reads. Others are inferred from values present in existing records and are marked non-authoritative by the MCP.
- Tracker integration, user options, compile overrides, templates, action groups, transfer checks, and ratification are especially site-specific.
- Internal or licensed REST documentation may be available to a user's organization. Use it when supplied, but do not reproduce confidential material in public skill output.

## Public References

- [TD/OMS product overview](https://remainsoftware.com/tdoms/) describes TD/OMS as application lifecycle and change management across IBM i, Windows, and Unix/Linux, including development, test, acceptance, deployment, impact analysis, version history, and ratification.
- [Octo TD/OMS Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=remainsoftware.octo-tdoms) documents Work Management, task details, source editing, object connection, checkout/promote, build queue, spool files, IFS, revision compare, analytics, dependencies, and Kanban in Octo.
- [TD/OMS productivity](https://remainsoftware.com/td-oms-increases-alm-productivity/) provides conceptual background for impact analysis, compare/merge, controlled deployment, rollback, transfer logs, and multi-platform deployment.
- [TD/OMS collaboration](https://remainsoftware.com/td-oms-increases-alm-collaboration/) explains ratification as a configurable approval process used for peer review, acceptance, or promotion gates.
- [TD/OMS V17.0.1 release](https://remainsoftware.com/news/new-release-td-oms-v17-0-milestone-1-2/) documents Octo transfer history, version conflicts, impact analysis, compile results, and members in component views.
- [Web and VS Code TD/OMS V17.0.2 release](https://remainsoftware.com/news/new-release-web-and-vscode-td-oms-v17-0-milestone-2/) documents compile-error visualization, transfer/log history, compile overrides, transfer-path behavior, programmer assignment, ratification history, and build-queue integrations.

Public pages are contextual sources only. Always defer executable details to the live MCP schema and the connected TD/OMS server.
