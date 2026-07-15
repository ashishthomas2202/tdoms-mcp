import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import nodePath from "node:path";
import tls from "node:tls";
import { normalizeBaseUrl } from "./config.js";

export class TdomsClient {
  constructor(connection, {
    httpRequest = http.request,
    httpsRequest = https.request,
    readFile = fs.readFile,
    env = process.env
  } = {}) {
    this.connection = connection;
    this.baseUrl = normalizeBaseUrl(connection);
    this.httpRequest = httpRequest;
    this.httpsRequest = httpsRequest;
    this.readFile = readFile;
    this.env = env;
  }

  async login(password = this.connection.password) {
    if (!this.connection.username) {
      throw new Error("TD/OMS username is required.");
    }

    if (password === undefined) {
      throw new Error("TD/OMS password is required for login.");
    }

    const response = await this.request("OMGAUTH", "/login", {
      method: "POST",
      body: {
        email_or_username: this.connection.username,
        password
      },
      token: this.connection.token
    });

    if (!response?.token) {
      throw new Error("TD/OMS login response did not include a token.");
    }

    return response.token;
  }

  async getSystemInfo(token = this.connection.token, applications) {
    const suffix = applications ? `/system?applications=${encodeURIComponent(applications)}` : "/system";
    return this.request("OMSINFO", suffix, {
      method: "GET",
      token
    });
  }

  async getLicenseInfo() {
    return this.request("OMSINFO", "/license", {
      method: "GET"
    });
  }

  async get(service, path, token = this.connection.token) {
    return this.request(service, path, {
      method: "GET",
      token
    });
  }

  async post(service, path, body, token = this.connection.token) {
    return this.request(service, path, {
      method: "POST",
      body,
      token
    });
  }

  async request(service, path, { method = "GET", body, token } = {}) {
    const url = new URL(`${this.baseUrl}/${service}${path}`);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = {
      accept: "application/json"
    };

    if (payload !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }

    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const options = {
      method,
      headers
    };

    if (url.protocol === "https:") {
      options.rejectUnauthorized = this.connection.verifyTls !== false;
      const caFile = this.connection.caFile || this.env.TDOMS_MCP_CA_FILE;
      if (caFile) {
        const customCa = await this.readFile(nodePath.resolve(caFile), "utf8");
        options.ca = [...tls.rootCertificates, customCa];
      }
    }

    const response = await sendRequest(
      url.protocol === "https:" ? this.httpsRequest : this.httpRequest,
      url,
      options,
      payload,
      Number.parseInt(this.env.TDOMS_MCP_HTTP_TIMEOUT_MS || "60000", 10)
    );
    const text = response.text;
    const parsed = text ? parseJsonResponse(text) : undefined;

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const detail = typeof parsed === "object" ? JSON.stringify(parsed) : text;
      throw new Error(`TD/OMS ${method} ${url.pathname} failed with ${response.statusCode}: ${detail}`);
    }

    return parsed;
  }
}

function sendRequest(request, url, options, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = request(url, options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        statusCode: response.statusCode || 0,
        text: Buffer.concat(chunks).toString("utf8")
      }));
      response.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`TD/OMS request timed out after ${timeoutMs}ms.`)));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function summarizeSystemInfo(systemInfo) {
  const applications = Array.isArray(systemInfo?.applications) ? systemInfo.applications : [];
  return {
    isOMSManager: Boolean(systemInfo?.isOMSManager),
    isSecurityManager: Boolean(systemInfo?.isSecurityManager),
    isExitManager: Boolean(systemInfo?.isExitManager),
    applicationCount: applications.length,
    applications: applications.map((application) => ({
      applicationCode: application.applicationCode,
      applicationName: application.applicationName,
      canCreateTasks: application.canCreateTasks,
      canCreateRequests: application.canCreateRequests,
      isUser: application.isUser,
      isProgrammer: application.isProgrammer,
      isManager: application.isManager,
      developmentEnvironment: application.developmentEnvironment,
      productionEnvironment: application.productionEnvironment,
      emergencyEnvironment: application.emergencyEnvironment
    }))
  };
}
