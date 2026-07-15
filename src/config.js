import os from "node:os";
import path from "node:path";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = Number.parseInt(process.env.TDOMS_MCP_UI_PORT || "3737", 10);

export function dataDir({ env = process.env, platform = process.platform, homedir = os.homedir() } = {}) {
  if (env.TDOMS_MCP_DATA_DIR) {
    return path.resolve(env.TDOMS_MCP_DATA_DIR);
  }

  const platformPath = platform === "win32" ? path.win32 : path.posix;

  if (platform === "win32" && env.APPDATA) {
    return platformPath.join(env.APPDATA, "tdoms-mcp");
  }

  if (platform === "darwin") {
    return platformPath.join(homedir, "Library", "Application Support", "tdoms-mcp");
  }

  return platformPath.join(env.XDG_CONFIG_HOME || platformPath.join(homedir, ".config"), "tdoms-mcp");
}

export function redactConnection(connection) {
  if (!connection) {
    return connection;
  }

  const { token, password, ...safeConnection } = connection;
  return safeConnection;
}

export function normalizeBaseUrl({ protocol, host, port, library }) {
  const cleanProtocol = protocol || "https";
  const cleanHost = String(host || "").trim();
  const cleanPort = String(port || "").trim();
  const cleanLibrary = String(library || "OMS").trim().replace(/^\/+|\/+$/g, "");

  if (!cleanHost) {
    throw new Error("TD/OMS host is required.");
  }

  if (!cleanPort) {
    throw new Error("TD/OMS REST port is required.");
  }

  return `${cleanProtocol}://${cleanHost}:${cleanPort}/${cleanLibrary}`;
}
