// `tdoms-mcp login`: save a connection and sign in from a terminal, for machines
// where the local web page is not practical. The password is read from a hidden
// prompt or TDOMS_MCP_PASSWORD and is never echoed or written to agent config.

import readline from "node:readline";
import { TdomsClient, summarizeSystemInfo } from "./tdoms-client.js";
import { updateWorkingContext } from "./working-context.js";

export function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split(/=(.*)/s);
    if (inline !== undefined) flags[key] = inline;
    else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) flags[key] = argv[++index];
    else flags[key] = true;
  }
  return flags;
}

export async function loginFromCli({
  store,
  flags,
  env = process.env,
  clientFactory = (connection) => new TdomsClient(connection),
  promptPassword = promptHidden
}) {
  const existing = (await store.listConnections()).find((connection) => connection.id === flags.connection || connection.name === flags.connection);
  if (flags.connection && !existing) throw new Error(`Connection not found: ${flags.connection}`);

  const input = {
    ...(existing || {}),
    name: flags.name || existing?.name,
    protocol: flags.protocol || existing?.protocol || "https",
    host: flags.host || existing?.host,
    port: flags.port || existing?.port,
    library: flags.library || existing?.library || "OMS",
    username: flags.username || existing?.username,
    caFile: flags["ca-file"] || existing?.caFile
  };
  const missing = ["host", "port", "username"].filter((field) => !input[field]);
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.map((field) => `--${field}`).join(", ")}. Example: tdoms-mcp login --host tdoms.example.com --port 45011 --username DEVUSER`);
  }

  const password = env.TDOMS_MCP_PASSWORD || await promptPassword(`TD/OMS password for ${input.username}@${input.host}: `);
  if (!password) throw new Error("A password is required.");

  // Sign in before saving so a wrong password leaves nothing behind.
  const client = clientFactory({ ...input, password });
  const token = await client.login(password);
  const system = summarizeSystemInfo(await client.getSystemInfo(token));

  const connection = await store.upsertConnection({ ...input, password });
  await store.saveToken(connection.id, token);
  if (flags["no-active"] !== true) {
    await updateWorkingContext(store, { activeConnectionId: connection.id });
  }
  return { ok: true, connection: await store.getConnection(connection.id), active: flags["no-active"] !== true, applicationCount: system.applicationCount };
}

export function promptHidden(question) {
  if (!process.stdin.isTTY) {
    throw new Error("No terminal is attached. Set TDOMS_MCP_PASSWORD to supply the password.");
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (text) => {
      if (!muted) rl.output.write(text);
    };
    rl.question(question, (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

export function promptVisible(question) {
  if (!process.stdin.isTTY) throw new Error("No terminal is attached.");
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// `tdoms-mcp octo-login`: optional sign-in to an Octo server. The password comes
// from a hidden prompt or TDOMS_MCP_OCTO_PASSWORD and is not stored.
export async function octoLoginFromCli({ flags, accounts, env = process.env, fetchImpl, promptPassword = promptHidden, promptCode = promptVisible, signIn }) {
  const url = typeof flags.url === "string" ? flags.url : undefined;
  const username = typeof flags.username === "string" ? flags.username : undefined;
  if (!url || !username) {
    throw new Error("Missing --url or --username. Example: tdoms-mcp octo-login --url https://octo.example.com/org/acme --username dev@example.com");
  }
  const password = env.TDOMS_MCP_OCTO_PASSWORD || await promptPassword(`Octo password for ${username}: `);
  if (!password) throw new Error("A password is required.");

  let outcome = await signIn({ url, username, password, code: typeof flags.code === "string" ? flags.code : undefined, accounts, fetchImpl });
  if (outcome.needsCode) {
    const code = await promptCode("Two-factor code: ");
    outcome = await signIn({ url, username, password, code, accounts, fetchImpl });
  }
  return outcome;
}
