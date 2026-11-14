export const OPTION_SETS = [
  "applications",
  "environments",
  "programmers",
  "userClasses",
  "taskStatuses",
  "taskTypes",
  "releases",
  "priorities",
  "branchesPaths",
  "taskObjects",
  "solutions",
  "transferTargets",
  "subEnvironments",
  "completionReasons",
  "ratificationReasons",
  "memberAttributes",
  "solutionTypes",
  "compileOverrides",
  "labels",
  "objectTemplates",
  "objectLocations",
  "revisions",
  "conflicts",
  "remoteJobs",
  "schedules",
  "trackerLinks",
  "userOptions",
  "tasks",
  "requests",
  "components",
  "connectionLists",
  "buildQueue",
  "compileResults",
  "transferHistory",
  "logs",
  "spoolFiles",
  "trackerRecords",
  "source",
  "dependencies",
  "dashboards"
];

const capabilities = [
  mutation("change-member-attribute", "Change Member Attribute", "openChangeMemberAttributeWizard", "OMQROB", "/change", ["memberAttributes"], ["applicationCode", "objectCode", "memberCode"], "OMXObjectDetailExtended"),
  mutation("change-programmer", "Change Programmer", "openChangeProgrammerWizard", "OMQRTA", "/change", ["programmers", "userClasses"], ["applicationCode", "taskNumber"], "OMXFixExtended"),
  mutation("change-solution-type", "Change Solution Type", "openChangeSolutionTypeWizard", "OMQRSO", "/multiChange", ["solutions", "solutionTypes"], ["applicationCode", "taskNumber"], "OMXSolutionExtended"),
  mutation("change-task-transfer-path", "Change Task Transfer Path", "openChangeTaskTransferPathWizard", "OMQRTA", "/change", ["branchesPaths"], ["applicationCode", "taskNumber"], "OMXFixExtended"),
  mutation("compile-override", "Compile Override", "openCompileOverrideWizard", "OMQRCO", "/change", ["compileOverrides", "taskObjects"], ["applicationCode", "taskNumber"], "OMXCompileOverrideExtended"),
  mutation("complete-task", "Complete Task", "openCompleteTaskWizard", "OMQRTA", "/complete", ["completionReasons"], ["applicationCode", "taskNumber"], "OMXFixExtended"),
  mutation("delete-objects", "Delete Objects", "openDeleteObjectsWizard", "OMQROB", "/delete", ["taskObjects"], ["applicationCode"], "OMXObjectExtended"),
  mutation("disconnect-solutions", "Disconnect Solutions", "openDisconnectSolutionsWizard", "OMQRSO", "/multiDisconnect", ["solutions"], ["applicationCode", "taskNumber"], "OMXSolutionExtended"),
  readOnly("display-message", "Display TD/OMS Message", "openDisplayMessageWizard", [], [], undefined, "Messages are returned directly in MCP responses; no UI window is required."),
  mutation("edit-branch", "Edit Branch", "openEditBranchWizard", "OMQRBR", "/change", ["branchesPaths"], ["applicationCode", "pathCode"], "OMXTransferPath"),
  mutation("fill-object-file", "Fill Object File", "openFillObjectFileWizard", "OMQRFO", "/fillObject", ["taskObjects"], ["applicationCode", "objectCode"], "OMXObjectExtended"),
  mutation("manage-label", "Manage Label", "openLabelWizard", "OMQRLB", "/label", ["labels"], ["applicationCode"], "OMXLabel"),
  mutation("link-issue-to-task", "Link Issue To Task", "openLinkIssueToTaskWizard", "OMQRTA", "/link/ticket", ["trackerLinks"], ["applicationCode", "taskNumber"], "OMXRequestTaskLink"),
  mutation("link-task-to-issue", "Link Task To Issue", "openLinkTaskToIssueWizard", "OMQRTA", "/link/ticket", ["trackerLinks"], ["applicationCode", "taskNumber"], "OMXRequestTaskLink"),
  mutation("move-solutions", "Move Solutions", "openMoveSolutionsWizard", "OMQRSO", "/multiMove", ["solutions", "branchesPaths"], ["applicationCode", "taskNumber"], "OMXSolutionExtended"),
  mutation("new-object", "New Object From Template", "openNewObjectTemplatesWizard", "OMQRNO", "/add", ["objectTemplates", "objectLocations"], ["applicationCode", "taskNumber", "environmentCode"], "OMXObjectExtended"),
  mutation("new-task-branch", "New Task Branch", "openNewTaskBranchWizard", "OMQRBR", "/add", ["branchesPaths"], ["applicationCode", "taskNumber"], "OMXTransferPath"),
  mutation("close-remote-job", "Close Remote Job", "openCloseRemoteJobWizard", "OMQRRJ", "/close", ["remoteJobs", "completionReasons"], ["applicationCode"], "OMXRemoteJobMonitorExtended"),
  mutation("reopen-remote-job", "Reopen Remote Job", "openReopenRemoteJobWizard", "OMQRRJ", "/reopen", ["remoteJobs"], ["applicationCode"], "OMXRemoteJobMonitorExtended"),
  mutation("schedule-remote-job", "Schedule Remote Job", "openScheduleRemoteJobWizard", "OMQRMD", "/schedule", ["remoteJobs", "schedules"], ["applicationCode"], "OMXRemoteJobMonitorExtended"),
  readOnly("revision-compare", "Revision Compare", "openRevisionCompareWizard", ["revisions"], ["applicationCode"], "OMXObjectTransferHistory"),
  readOnly("solution-conflict", "Solution Conflict", "openSolutionConflictWizard", ["solutions", "conflicts"], ["applicationCode", "taskNumber"], "OMXObjectVersionConflict", "Conflict resolution is site-specific; discovery is supported and mutation requires a documented site endpoint."),
  mutation("task-ratification", "Task Ratification", "openTaskRatificationWizard", "OMQRTA", "/ratify", ["ratificationReasons", "programmers"], ["applicationCode", "taskNumber"], "OMXFixExtended"),
  unsupported("tracker-server-manager", "Tracker Server Manager", "openTrackerServerManagerWizard", "Tracker server administration belongs to Octo configuration and has no known TD/OMS REST endpoint."),
  mutation("transfer", "Transfer, Checkout, Or Promote", "openTransferWizard", "OMQRTO", "/prepare", ["taskObjects", "transferTargets", "subEnvironments"], ["applicationCode", "taskNumber"], "OMXSolutionExtended"),
  mutation("unlink-task-from-issue", "Unlink Task From Issue", "openUnlinkTaskFromIssueWizard", "OMQRTA", "/unlink/ticket", ["trackerLinks"], ["applicationCode", "taskNumber"], "OMXRequestTaskLink"),
  mutation("execute-user-option", "Execute User Option", "openUserOptionWizard", "OMQRUO", "/execute", ["userOptions"], ["applicationCode", "taskNumber"], "OMXUserOption"),
  mutation("resolve-version-conflict", "Resolve Version Conflict", "openVersionConflictsWizard", "OMQRVC", "/confirm", ["conflicts"], ["applicationCode", "taskNumber"], "OMXObjectVersionConflict")
];

export const CAPABILITIES = Object.freeze(capabilities.map((capability) => Object.freeze(capability)));
export const CAPABILITY_IDS = CAPABILITIES.map((capability) => capability.id);

export function getCapability(id) {
  return CAPABILITIES.find((capability) => capability.id === id);
}

function mutation(id, title, octoWizard, service, path, optionSets, requiredContext, stateTable) {
  return {
    id,
    title,
    octoWizard,
    category: "change-management",
    support: "supported",
    mode: "mutation",
    optionSets,
    requiredContext,
    stateTable,
    execution: { method: "POST", service, path }
  };
}

function readOnly(id, title, octoWizard, optionSets, requiredContext, stateTable, note) {
  return {
    id,
    title,
    octoWizard,
    category: "change-management",
    support: "supported",
    mode: "read-only",
    optionSets,
    requiredContext,
    stateTable,
    note
  };
}

function unsupported(id, title, octoWizard, note) {
  return {
    id,
    title,
    octoWizard,
    category: "octo-only",
    support: "unsupported",
    mode: "read-only",
    optionSets: [],
    requiredContext: [],
    note
  };
}
