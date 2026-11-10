import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function ensurePrivateDirectory(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    await fs.chmod(dir, 0o700);
  }
}

export async function atomicWriteFile(filePath, data, { mode = 0o600 } = {}) {
  const dir = path.dirname(filePath);
  await ensurePrivateDirectory(dir);
  const temporaryPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let handle;

  try {
    handle = await fs.open(temporaryPath, "wx", mode);
    await handle.writeFile(data, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameWithRetry(temporaryPath, filePath);
    if (process.platform !== "win32") {
      await fs.chmod(filePath, mode);
    }
    await syncDirectory(dir);
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

export async function withFileLock(filePath, operation, {
  timeoutMs = 10000,
  staleMs = 30000,
  retryMs = 20,
  privateDirectory = true
} = {}) {
  const lockPath = `${filePath}.lock`;
  const token = `${process.pid}:${crypto.randomUUID()}`;
  const startedAt = Date.now();
  if (privateDirectory) await ensurePrivateDirectory(path.dirname(filePath));
  else await fs.mkdir(path.dirname(filePath), { recursive: true });

  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(token, "utf8");
      await handle.close();
      break;
    } catch (error) {
      const transientWindowsContention = process.platform === "win32" && ["EACCES", "EPERM"].includes(error.code);
      if (error.code !== "EEXIST" && !transientWindowsContention) {
        throw error;
      }

      if (error.code === "EEXIST") {
        await removeStaleLock(lockPath, staleMs);
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for local storage lock: ${lockPath}`);
      }
      await delay(retryMs);
    }
  }

  try {
    return await operation();
  } finally {
    await releaseOwnedLock(lockPath, token);
  }
}

export async function hardenDataDirectory(dir, { platform = process.platform } = {}) {
  await ensurePrivateDirectory(dir);
  if (platform !== "win32") {
    await fs.chmod(dir, 0o700);
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isFile()) {
        await fs.chmod(path.join(dir, entry.name), 0o600);
      }
    }
    return { platform, directoryMode: "0700", fileMode: "0600" };
  }

  const script = String.raw`
$target = $env:TDOMS_ACL_TARGET
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$propagation = [System.Security.AccessControl.PropagationFlags]::None
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$sids = @(
  [System.Security.Principal.WindowsIdentity]::GetCurrent().User,
  (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')),
  (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544'))
)
foreach ($sid in $sids) {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inheritance, $propagation, $allow)
  $acl.AddAccessRule($rule)
}
[System.IO.Directory]::SetAccessControl($target, $acl)
`;
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    env: { ...process.env, TDOMS_ACL_TARGET: dir }
  });
  return { platform, acl: "current-user, SYSTEM, Administrators" };
}

async function removeStaleLock(lockPath, staleMs) {
  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs > staleMs) {
      await fs.unlink(lockPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  } catch (error) {
    if (error.code !== "ENOENT" && !isTransientWindowsError(error)) {
      throw error;
    }
  }
}

async function releaseOwnedLock(lockPath, token) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      if ((await fs.readFile(lockPath, "utf8")) === token) {
        await fs.unlink(lockPath);
      }
      return;
    } catch (error) {
      if (error.code === "ENOENT") return;
      if (!isTransientWindowsError(error) || attempt === 19) throw error;
      await delay(10 + attempt * 5);
    }
  }
}

function isTransientWindowsError(error) {
  return process.platform === "win32" && ["EACCES", "EBUSY", "EPERM"].includes(error.code);
}

async function renameWithRetry(source, target) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      if (!isTransientWindowsError(error) || attempt === 19) throw error;
      await delay(10 + attempt * 5);
    }
  }
}

async function syncDirectory(dir) {
  if (process.platform === "win32") return;
  let handle;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
  } catch {
    // Some filesystems do not support syncing directory handles.
  } finally {
    await handle?.close().catch(() => {});
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
