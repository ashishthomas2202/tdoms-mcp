// Request shapes and helpers for linking TD/OMS tasks to tracker issues
// (OMQRTA /link/ticket and /unlink/ticket).
//
// The write entities differ from the read view. OMXRequestTaskLink returns
// productCode and uUID; the link request expects freeFormatProductId and
// universalUniqueId. The field lists below follow the request entities that
// the Octo client posts.

export const LINK_TABLE = "OMXRequestTaskLink";

export const LINK_TICKET_FIELDS = Object.freeze({
  applicationCode: "TD/OMS application code of the task.",
  taskNumber: "TD/OMS task number to link.",
  requestNumber: "Optional TD/OMS request number; leave empty for a task link.",
  freeFormatProductId: "Tracker product id that TD/OMS stores as productCode, for example JIRA.",
  urlToItem: "URL TD/OMS stores for the issue; use the same form (web or API URL) as the site's existing links.",
  urlToProduct: "Base URL of the tracker server.",
  universalUniqueId: "Tracker's own id for the issue (for Jira, the numeric issue id).",
  disableIndicator: "Link disable flag; \"0\" for an active link.",
  remoteIssueInformation: "Display name of the issue shown in TD/OMS, for example \"KEY-1 : Summary\"."
});

export const UNLINK_TICKET_FIELDS = Object.freeze({
  applicationCode: LINK_TICKET_FIELDS.applicationCode,
  taskNumber: "TD/OMS task number to unlink.",
  requestNumber: LINK_TICKET_FIELDS.requestNumber,
  freeFormatProductId: LINK_TICKET_FIELDS.freeFormatProductId,
  urlToItem: "URL of the linked issue exactly as TD/OMS stores it (urlToItem of the existing link)."
});

export const REQUIRED_TICKET_FIELDS = Object.freeze(["applicationCode", "taskNumber", "freeFormatProductId", "urlToItem"]);

// Read-side names (as listed from OMXRequestTaskLink) and friendly workflow
// names, mapped to the request field they stand for.
export const TICKET_FIELD_ALIASES = Object.freeze({
  productCode: "freeFormatProductId",
  productId: "freeFormatProductId",
  uUID: "universalUniqueId",
  uuid: "universalUniqueId",
  issueId: "universalUniqueId",
  issueUrl: "urlToItem",
  trackerUrl: "urlToProduct",
  issueTitle: "remoteIssueInformation",
  fixNumber: "taskNumber",
  task: "taskNumber"
});

// Tracker types whose links Octo stores with the REST API URL of the issue
// rather than the browser URL. Matches Octo's isWebUrlUsedForLinking = false.
const API_URL_PRODUCTS = new Set(["JIRA", "FRESHDESK", "FRESHSERVICE"]);
const KNOWN_PRODUCT_SPELLING = { JIRA: "JIRA", FRESHDESK: "Freshdesk", FRESHSERVICE: "Freshservice", GRAVITY: "Gravity" };
const REMOTE_ISSUE_INFORMATION_LENGTH = 50;
const DEFAULT_JIRA_API_PATH = "/rest/api/latest/issue/";

/**
 * Map caller input onto the request field names. Canonical names win over
 * aliases; anything that is not a request field is dropped.
 */
export function normalizeTicketFields(input = {}, kind = "link") {
  const allowed = kind === "unlink" ? UNLINK_TICKET_FIELDS : LINK_TICKET_FIELDS;
  const fields = {};
  for (const [alias, target] of Object.entries(TICKET_FIELD_ALIASES)) {
    if (hasValue(input[alias]) && target in allowed) fields[target] = clean(input[alias]);
  }
  for (const field of Object.keys(allowed)) {
    if (hasValue(input[field])) fields[field] = clean(input[field]);
  }
  return fields;
}

export function missingTicketFields(fields) {
  return REQUIRED_TICKET_FIELDS.filter((field) => !hasValue(fields[field]));
}

export function assertTicketFields(fields, kind = "link") {
  const missing = missingTicketFields(fields);
  if (missing.length > 0) {
    throw new Error(`Cannot ${kind} the ticket: ${missing.join(", ")} must not be blank.`);
  }
}

export function buildLinkTicketBody(fields) {
  return dropEmpty({
    applicationCode: fields.applicationCode,
    taskNumber: fields.taskNumber,
    requestNumber: fields.requestNumber,
    freeFormatProductId: fields.freeFormatProductId,
    urlToItem: fields.urlToItem,
    urlToProduct: fields.urlToProduct,
    universalUniqueId: fields.universalUniqueId,
    disableIndicator: hasValue(fields.disableIndicator) ? fields.disableIndicator : "0",
    remoteIssueInformation: fields.remoteIssueInformation
  });
}

export function buildUnlinkTicketBody(fields) {
  return dropEmpty({
    applicationCode: fields.applicationCode,
    taskNumber: fields.taskNumber,
    requestNumber: fields.requestNumber,
    freeFormatProductId: fields.freeFormatProductId,
    urlToItem: fields.urlToItem
  });
}

export function findExistingLink(rows, { applicationCode, taskNumber, urlToItem }) {
  return (rows || []).find((row) => same(row.applicationCode, applicationCode)
    && same(row.taskNumber, taskNumber)
    && same(row.urlToItem, urlToItem));
}

/**
 * Choose the tracker product id from the products already in use. Spellings
 * that differ only in case count as one product; the spelling Octo uses (or
 * else the one seen first) is returned.
 */
export function chooseProduct(products, { host } = {}) {
  const scoped = host ? products.filter((row) => hostOf(row.urlToProduct) === host) : products;
  const groups = new Map();
  for (const row of scoped) {
    if (!hasValue(row.productCode)) continue;
    const key = clean(row.productCode).toUpperCase();
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(clean(row.productCode));
  }
  const choices = [...groups.entries()].map(([key, spellings]) => {
    const known = KNOWN_PRODUCT_SPELLING[key];
    return known && spellings.has(known) ? known : [...spellings][0];
  });
  if (choices.length === 1) return { productId: choices[0], choices };
  return { productId: undefined, choices };
}

export function isApiUrl(url) {
  return /\/rest\/api\//i.test(String(url || "")) || /\/api\/v\d+\//i.test(String(url || ""));
}

/** "api" or "web": the form this site stores for the product, from existing rows. */
export function siteUrlForm(rows, productId) {
  const relevant = rows.filter((row) => same(row.productCode, productId) && hasValue(row.urlToItem));
  if (relevant.length > 0) {
    const api = relevant.filter((row) => isApiUrl(row.urlToItem)).length;
    return api * 2 >= relevant.length ? "api" : "web";
  }
  return API_URL_PRODUCTS.has(String(productId || "").toUpperCase()) ? "api" : "web";
}

export function hostOf(url) {
  try {
    return new URL(String(url)).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Resolve a link or unlink request from friendly workflow input and the
 * site's existing link rows. Returns { body, defaultsApplied, warnings } or
 * { blockers } (and alreadyLinked / existing when relevant).
 *
 * products: distinct { productCode, urlToProduct } rows for the application.
 * recentRows: recent OMXRequestTaskLink rows for the application, newest first.
 * taskRows: OMXRequestTaskLink rows for the task being changed.
 */
export function resolveTicketRequest({ kind = "link", input = {}, products = [], recentRows = [], taskRows = [] }) {
  const fields = normalizeTicketFields(input, "link");
  const issueKey = clean(input.issueKey);
  const defaultsApplied = {};
  const warnings = [];
  const blockers = [];

  for (const field of ["applicationCode", "taskNumber"]) {
    if (!hasValue(fields[field])) blockers.push(`Missing ${field}.`);
  }
  if (blockers.length) return { blockers };

  if (kind === "unlink") return resolveUnlink({ fields, issueKey, taskRows });

  const host = hostOf(fields.urlToItem) || hostOf(fields.urlToProduct);

  if (!hasValue(fields.freeFormatProductId)) {
    const { productId, choices } = chooseProduct(products, { host });
    if (!productId) {
      return {
        blockers: [choices.length === 0
          ? "No tracker product is in use for this application, so freeFormatProductId cannot be defaulted. Pass productId (for example the tracker type such as JIRA)."
          : `Several tracker products are in use for this application: ${choices.join(", ")}. Pass productId to choose one.`],
        choices: { freeFormatProductId: choices }
      };
    }
    fields.freeFormatProductId = productId;
    defaultsApplied.freeFormatProductId = productId;
  }
  const productId = fields.freeFormatProductId;

  if (!hasValue(fields.urlToProduct)) {
    const candidates = unique(products
      .filter((row) => same(row.productCode, productId) && hasValue(row.urlToProduct))
      .filter((row) => !host || hostOf(row.urlToProduct) === host)
      .map((row) => clean(row.urlToProduct)));
    const recent = recentRows.find((row) => same(row.productCode, productId) && candidates.includes(clean(row.urlToProduct)));
    const hosts = unique(candidates.map(hostOf));
    if (hosts.length === 1) {
      fields.urlToProduct = recent ? clean(recent.urlToProduct) : candidates[0];
      defaultsApplied.urlToProduct = fields.urlToProduct;
    } else if (hosts.length > 1) {
      return {
        blockers: [`Several ${productId} servers are in use: ${candidates.join(", ")}. Pass trackerUrl or the issue URL to choose one.`],
        choices: { urlToProduct: candidates }
      };
    }
  }

  const form = siteUrlForm(recentRows, productId);
  const base = trimSlash(fields.urlToProduct || originOf(fields.urlToItem));
  const apiPath = apiPathFrom(recentRows, productId) || DEFAULT_JIRA_API_PATH;
  const isJira = String(productId).toUpperCase() === "JIRA";

  if (hasValue(fields.urlToItem)) {
    const given = fields.urlToItem;
    if (form === "api" && !isApiUrl(given)) {
      if (hasValue(fields.universalUniqueId) && base) {
        fields.urlToItem = `${base}${apiPath}${fields.universalUniqueId}`;
        defaultsApplied.urlToItem = fields.urlToItem;
      } else {
        return { blockers: [`This site stores ${productId} links with the API URL of the issue, not the web URL. Pass issueId (the tracker's numeric issue id) so the API URL can be built.`] };
      }
    } else if (form === "web" && isApiUrl(given)) {
      if (isJira && issueKey && base) {
        fields.urlToItem = `${base}/browse/${issueKey}`;
        defaultsApplied.urlToItem = fields.urlToItem;
      } else {
        warnings.push(`This site stores ${productId} links with the web URL, but an API URL was given; it is used as is.`);
      }
    }
  } else if (form === "api" && hasValue(fields.universalUniqueId) && base) {
    fields.urlToItem = `${base}${apiPath}${fields.universalUniqueId}`;
    defaultsApplied.urlToItem = fields.urlToItem;
  } else if (form === "web" && isJira && issueKey && base) {
    fields.urlToItem = `${base}/browse/${issueKey}`;
    defaultsApplied.urlToItem = fields.urlToItem;
  }

  if (!hasValue(fields.universalUniqueId) && isApiUrl(fields.urlToItem)) {
    const id = String(fields.urlToItem).split(/[/?#]/).filter(Boolean).pop();
    if (id) {
      fields.universalUniqueId = id;
      defaultsApplied.universalUniqueId = id;
    }
  }
  if (!hasValue(fields.universalUniqueId)) warnings.push("universalUniqueId (issueId) is blank; the tracker's issue id is normally stored with the link.");

  if (!hasValue(fields.remoteIssueInformation) && issueKey) fields.remoteIssueInformation = issueKey;
  else if (hasValue(fields.remoteIssueInformation) && issueKey && !fields.remoteIssueInformation.startsWith(issueKey)) {
    fields.remoteIssueInformation = `${issueKey} : ${fields.remoteIssueInformation}`;
  }
  if (hasValue(fields.remoteIssueInformation) && fields.remoteIssueInformation.length > REMOTE_ISSUE_INFORMATION_LENGTH) {
    fields.remoteIssueInformation = fields.remoteIssueInformation.slice(0, REMOTE_ISSUE_INFORMATION_LENGTH).trimEnd();
  }

  const missing = missingTicketFields(fields);
  if (missing.length > 0) {
    return { blockers: [`Cannot link the ticket: ${missing.join(", ")} must not be blank. Pass issueUrl or issueId so urlToItem can be set.`] };
  }

  const existing = findExistingLink(taskRows, fields);
  if (existing) {
    return { alreadyLinked: true, existing, blockers: [`Task ${fields.applicationCode} ${fields.taskNumber} is already linked to ${fields.urlToItem}.`] };
  }

  return { body: buildLinkTicketBody(fields), defaultsApplied, warnings };
}

function resolveUnlink({ fields, issueKey, taskRows }) {
  const rows = taskRows.filter((row) => same(row.applicationCode, fields.applicationCode) && same(row.taskNumber, fields.taskNumber));
  const matches = rows.filter((row) => {
    if (hasValue(fields.urlToItem) && same(row.urlToItem, fields.urlToItem)) return true;
    if (hasValue(fields.universalUniqueId) && same(row.uUID, fields.universalUniqueId)) return true;
    if (issueKey && (same(row.uUID, issueKey) || String(row.remoteIssueInformation || "").startsWith(issueKey) || String(row.urlToItem || "").endsWith(`/${issueKey}`))) return true;
    return false;
  }).filter((row) => !hasValue(fields.freeFormatProductId) || same(row.productCode, fields.freeFormatProductId));

  if (matches.length === 0) {
    return { blockers: [`Task ${fields.applicationCode} ${fields.taskNumber} has no matching ticket link to remove.`], existing: rows };
  }
  if (matches.length > 1) {
    return { blockers: ["Several ticket links match; pass urlToItem of the one to remove."], existing: matches };
  }
  const row = matches[0];
  const resolved = {
    applicationCode: fields.applicationCode,
    taskNumber: fields.taskNumber,
    requestNumber: fields.requestNumber,
    freeFormatProductId: fields.freeFormatProductId || clean(row.productCode),
    urlToItem: clean(row.urlToItem)
  };
  const defaultsApplied = {};
  if (!hasValue(fields.freeFormatProductId)) defaultsApplied.freeFormatProductId = resolved.freeFormatProductId;
  if (!same(fields.urlToItem, resolved.urlToItem)) defaultsApplied.urlToItem = resolved.urlToItem;
  const missing = missingTicketFields(resolved);
  if (missing.length) return { blockers: [`Cannot unlink the ticket: ${missing.join(", ")} must not be blank.`] };
  return { body: buildUnlinkTicketBody(resolved), defaultsApplied, warnings: [], existing: row };
}

function apiPathFrom(rows, productId) {
  for (const row of rows) {
    if (!same(row.productCode, productId) || !isApiUrl(row.urlToItem) || !hasValue(row.uUID)) continue;
    const url = clean(row.urlToItem);
    const id = clean(row.uUID);
    if (!url.endsWith(id)) continue;
    try {
      const path = new URL(url.slice(0, url.length - id.length)).pathname;
      if (path.endsWith("/")) return path;
    } catch {
      // ignore malformed stored URLs
    }
  }
  return undefined;
}

function originOf(url) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return undefined;
  }
}

function trimSlash(value) {
  return value ? String(value).replace(/\/+$/, "") : value;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function same(left, right) {
  return hasValue(left) && hasValue(right) && clean(left).toUpperCase() === clean(right).toUpperCase();
}

function clean(value) {
  return String(value ?? "").trim();
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function dropEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => hasValue(entry)));
}
