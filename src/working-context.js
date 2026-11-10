// The working context holds the defaults an agent or app has chosen: the active
// connection, application, task, environment and transfer path. Tools fall back to
// these values when the caller leaves them out.

export const WORKING_CONTEXT_FIELDS = Object.freeze([
  "activeConnectionId",
  "applicationCode",
  "taskNumber",
  "requestNumber",
  "environmentCode",
  "pathCode"
]);

const memory = new WeakMap();

export async function readWorkingContext(store) {
  if (typeof store?.getWorkingContext === "function") {
    return sanitize(await store.getWorkingContext());
  }
  return sanitize(memory.get(store));
}

export async function updateWorkingContext(store, patch = {}, { clear = false } = {}) {
  const next = clear ? {} : { ...(await readWorkingContext(store)) };
  for (const field of WORKING_CONTEXT_FIELDS) {
    if (!(field in patch) || patch[field] === undefined) continue;
    const value = patch[field] === null ? "" : String(patch[field]).trim();
    if (value) next[field] = value;
    else delete next[field];
  }
  if (typeof store?.setWorkingContext === "function") {
    await store.setWorkingContext(next);
  } else if (store && typeof store === "object") {
    memory.set(store, next);
  }
  return next;
}

function sanitize(value) {
  const output = {};
  for (const field of WORKING_CONTEXT_FIELDS) {
    if (typeof value?.[field] === "string" && value[field]) output[field] = value[field];
  }
  return output;
}
