// Request shapes for OMQRSO solution actions. TD/OMS expects a nested body
// (interfaceLevel, processing options, data) and identifies a solution with
// fixNumber, objectCode, objectType, memberCode, routeCode and
// pathExtensionLibraryCode taken from the task's OMXSolutionExtended row.
// A flat body, or one without data, is treated as an IFS object and fails.
// The shapes follow the requests the Octo client posts.

export const SOLUTION_TABLE = "OMXSolutionExtended";
export const INTERFACE_LEVEL = "V3R0M0";

export const SOLUTION_SELECTOR_FIELDS = Object.freeze({
  applicationCode: "TD/OMS application code.",
  taskNumber: "Task (fix) number the solution belongs to.",
  objectCode: "Object name, for example ORDENTRY.",
  objectType: "Object type, for example *PGM or *FILE.",
  memberCode: "Member name, when the solution is for a member.",
  objectLibrary: "Library of the object on the task, used only to pick the right row.",
  iFSObjectCode: "IFS object name, for IFS solutions.",
  iFSDirectoryCode: "IFS directory, for IFS solutions."
});

/** Rows a selector picks from the task's solution rows. */
export function matchSolutions(rows, selector = {}) {
  const want = (field, value) => !hasValue(value) || same(field, value);
  return (rows || []).filter((row) => want(row.objectCode, selector.objectCode)
    && want(row.objectType, selector.objectType)
    && want(row.memberCode, selector.memberCode)
    && want(row.objectLibrary, selector.objectLibrary)
    && want(row.iFSObjectCode, isIfs(row) ? selector.iFSObjectCode : undefined)
    && want(row.iFSDirectoryCode, selector.iFSDirectoryCode));
}

/**
 * Resolve each selector to exactly one solution row of the task.
 * Returns { rows } or { blockers }.
 */
export function selectSolutions(rows, selectors, { applicationCode, taskNumber } = {}) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const blockers = [];
  const picked = [];
  if (list.length === 0 || list.every((selector) => !hasValue(selector?.objectCode) && !hasValue(selector?.iFSObjectCode))) {
    return { blockers: ["Name at least one solution: objectCode and objectType (and memberCode for a member), or iFSObjectCode for an IFS object."] };
  }
  for (const selector of list) {
    const label = describe(selector);
    if (!hasValue(selector?.objectCode) && !hasValue(selector?.iFSObjectCode)) {
      blockers.push(`A solution entry has no objectCode or iFSObjectCode: ${JSON.stringify(selector)}.`);
      continue;
    }
    const matches = matchSolutions(rows, selector);
    if (matches.length === 0) {
      blockers.push(`${label} is not a solution on task ${applicationCode || ""} ${taskNumber || ""}`.replace(/\s+/g, " ").trim() + ".");
    } else if (matches.length > 1) {
      blockers.push(`${label} matches ${matches.length} solutions on the task (${matches.map(describe).join("; ")}). Add objectType, memberCode or objectLibrary.`);
    } else if (!picked.includes(matches[0])) {
      picked.push(matches[0]);
    }
  }
  return blockers.length ? { blockers, available: (rows || []).map(describe) } : { rows: picked };
}

/** SolutionData identity for a solution row, as Octo builds it for multi requests. */
export function solutionIdentity(row, { ifsMarker = false, routeForIfs = false } = {}) {
  const base = { applicationCode: row.applicationCode, fixNumber: row.fixNumber ?? row.taskNumber };
  if (isIfs(row)) {
    return dropEmpty({
      ...base,
      iFSDirectoryCode: row.iFSDirectoryCode,
      iFSObjectCode: row.iFSObjectCode,
      objectType: row.objectType,
      ...(routeForIfs ? { routeCode: row.routeCode, pathExtensionLibraryCode: row.pathExtensionLibraryCode } : {})
    });
  }
  return keepBlankStrings({
    ...base,
    ...(ifsMarker ? { iFSObjectCode: "*OBJC" } : {}),
    objectCode: row.objectCode,
    objectType: row.objectType,
    memberCode: row.memberCode ?? "",
    routeCode: row.routeCode ?? "",
    pathExtensionLibraryCode: row.pathExtensionLibraryCode ?? ""
  });
}

export function buildMultiDisconnectRequest(rows, { deleteObjectAndSource = false } = {}) {
  return {
    interfaceLevel: INTERFACE_LEVEL,
    multiDisconnectProcessingOptions: { updateBuffer: "1", updateDb: "1", deleteObjectAndSource: deleteObjectAndSource ? "1" : "0" },
    multiDisconnectData: rows.map((row) => solutionIdentity(row))
  };
}

export function buildMultiLockRequest(rows) {
  return {
    interfaceLevel: INTERFACE_LEVEL,
    multiLockProcessingOptions: { updateBuffer: "1", updateDb: "1", deleteObjectAndSource: "0" },
    multiLockData: rows.map((row) => solutionIdentity(row, { ifsMarker: true, routeForIfs: true }))
  };
}

export function buildMultiUnlockRequest(rows, { forceActiveSolution = false } = {}) {
  return {
    interfaceLevel: INTERFACE_LEVEL,
    multiUnlockProcessingOptions: { updateBuffer: "1", updateDb: "1", forceActiveSolution: forceActiveSolution ? "1" : "0" },
    multiUnlockData: rows.map((row) => solutionIdentity(row, { ifsMarker: true, routeForIfs: true }))
  };
}

export function buildMultiMoveRequest(rows, toFix) {
  return {
    interfaceLevel: INTERFACE_LEVEL,
    multiMoveProcessingOptions: { updateBuffer: "1", updateDb: "1", toFix },
    multiMoveData: rows.map((row) => {
      const identity = solutionIdentity(row, { ifsMarker: true });
      delete identity.routeCode;
      delete identity.pathExtensionLibraryCode;
      return identity;
    })
  };
}

export function buildMultiChangeRequest(rows, changes = {}) {
  return {
    interfaceLevel: INTERFACE_LEVEL,
    multiChangeProcessingOptions: { updateBuffer: "1", updateDb: "1" },
    multiChangeData: rows.map((row) => ({
      ...solutionIdentity(row, { ifsMarker: true, routeForIfs: true }),
      solutionType: pick(changes.solutionType, row.solutionType),
      sourceProcessing: pick(changes.sourceProcessing, row.sourceProcessing),
      overrideCode: pick(changes.overrideCode, row.overrideCode, ""),
      longDescription: "*SAME"
    }))
  };
}

export const CONNECT_FIELDS = Object.freeze({
  applicationCode: "TD/OMS application code.",
  taskNumber: "Task (fix) number to connect the object to.",
  objectCode: "Object name.",
  objectType: "Object type, for example *PGM.",
  memberCode: "Member name, when connecting a member.",
  objectLibrary: "Library the object is taken from.",
  environmentCode: "Environment the object is taken from, for example the development environment.",
  solutionType: "Solution type code.",
  sourceProcessing: "Source processing code.",
  overrideCode: "Compile override code.",
  statusField: "Solution status, for example *ACT.",
  iFSObjectCode: "IFS object name, for IFS solutions.",
  iFSDirectoryCode: "IFS directory, for IFS solutions."
});

export function buildConnectRequest(fields, options = {}) {
  const ifs = hasValue(fields.iFSObjectCode) && !hasValue(fields.objectCode);
  const connectData = dropEmpty({
    applicationCode: fields.applicationCode,
    fixNumber: fields.fixNumber ?? fields.taskNumber,
    ...(ifs
      ? { iFSDirectoryCode: fields.iFSDirectoryCode, iFSObjectCode: fields.iFSObjectCode }
      : { objectCode: fields.objectCode, objectType: fields.objectType, memberCode: fields.memberCode }),
    objectLibrary: fields.objectLibrary,
    environmentCode: fields.environmentCode,
    solutionType: fields.solutionType,
    sourceProcessing: fields.sourceProcessing,
    overrideCode: fields.overrideCode,
    statusField: fields.statusField
  });
  return {
    interfaceLevel: INTERFACE_LEVEL,
    connectProcessingOptions: dropEmpty({ updateBuffer: "1", updateDb: "1", forceActiveSolution: options.forceActiveSolution ? "1" : undefined }),
    connectData
  };
}

export function assertConnectFields(fields) {
  const missing = ["applicationCode", "taskNumber"].filter((field) => !hasValue(fields[field] ?? (field === "taskNumber" ? fields.fixNumber : undefined)));
  if (!hasValue(fields.objectCode) && !hasValue(fields.iFSObjectCode)) missing.push("objectCode");
  if (hasValue(fields.objectCode) && !hasValue(fields.objectType)) missing.push("objectType");
  if (missing.length) throw new Error(`Cannot connect the solution: ${missing.join(", ")} must not be blank.`);
}

// Wrapper key each OMQRSO action needs; used to reject flat raw bodies.
export const SOLUTION_ACTION_DATA_KEYS = Object.freeze({
  "/disconnect": "solutionData",
  "/connect": "connectData",
  "/change": "changeData",
  "/move": "moveData",
  "/multiDisconnect": "multiDisconnectData",
  "/multiLock": "multiLockData",
  "/multiUnlock": "multiUnlockData",
  "/multiMove": "multiMoveData",
  "/multiChange": "multiChangeData"
});

export function isTruthyFlag(value) {
  return value === true || ["1", "true", "yes", "y"].includes(String(value ?? "").trim().toLowerCase());
}

export function describe(row = {}) {
  if (hasValue(row.iFSObjectCode) && (isIfs(row) || !hasValue(row.objectCode))) {
    return [row.iFSDirectoryCode, row.iFSObjectCode].filter(hasValue).join("/");
  }
  const name = [row.objectLibrary, row.objectCode].filter(hasValue).join("/");
  return [name, row.objectType, row.memberCode].filter(hasValue).join(" ");
}

function isIfs(row) {
  return String(row?.objectClass ?? "").trim().toUpperCase() === "B";
}

function pick(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function same(left, right) {
  return String(left ?? "").trim().toUpperCase() === String(right ?? "").trim().toUpperCase();
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function dropEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => hasValue(entry)));
}

function keepBlankStrings(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}
