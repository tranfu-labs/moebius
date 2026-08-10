import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * macOS 通知权限适配：通过签名应用 bundle 内的 Swift 原生可执行读取/请求授权。
 *
 * spike 结论：UNUserNotificationCenter 要求调用进程位于 .app bundle 内
 * （bundleProxyForCurrentProcess），命令行直跑会崩溃；macos-notification-state
 * 1/2/3.x 只提供锁屏/勿扰状态，不提供授权查询。因此采用自建 Swift 桥
 * （desktop/native/macos-notification-permission），已实机验证 status 读取。
 *
 * 身份契约（QA #135 FQA-03）：授权按 bundle 标识存储，桥必须以与通知提交相同的
 * 应用身份读写。打包态两者都是 io.tranfu.moebius；开发态通知由 Electron 提交
 * （com.github.Electron），因此把当前运行 bundle 标识传给桥，桥在启动时改写自身
 * Info.plist 再访问 UNUserNotificationCenter。
 */

export type MacOsNotificationAuthorizationStatus =
  | "notDetermined"
  | "authorized"
  | "denied"
  | "provisional"
  | "unknown";

export type MacOsNotificationSettingValue = "notSupported" | "disabled" | "enabled" | "unknown";

export interface MacOsNotificationPermissionSnapshot {
  authorizationStatus: MacOsNotificationAuthorizationStatus;
  alert: MacOsNotificationSettingValue;
  sound: MacOsNotificationSettingValue;
  badge: MacOsNotificationSettingValue;
  /** 桥调用失败（可执行缺失/非 bundle 上下文/解析失败）。 */
  error: string | null;
}

export type MacOsPermissionAction = "status" | "request";

export interface MacOsPermissionAdapter {
  read(): Promise<MacOsNotificationPermissionSnapshot>;
  request(): Promise<MacOsNotificationPermissionSnapshot>;
}

function parseSnapshot(stdout: string): Omit<MacOsNotificationPermissionSnapshot, "error"> {
  const parsed = JSON.parse(stdout) as Partial<MacOsNotificationPermissionSnapshot>;
  const authorizationStatus = parsed.authorizationStatus === "notDetermined"
    || parsed.authorizationStatus === "authorized"
    || parsed.authorizationStatus === "denied"
    || parsed.authorizationStatus === "provisional"
    ? parsed.authorizationStatus
    : "unknown";
  const setting = (value: unknown): MacOsNotificationSettingValue =>
    value === "notSupported" || value === "disabled" || value === "enabled" ? value : "unknown";
  return {
    authorizationStatus,
    alert: setting(parsed.alert),
    sound: setting(parsed.sound),
    badge: setting(parsed.badge),
  };
}

/**
 * 当前运行进程的 bundle 标识：从 process.execPath 所在的 .app 读 Info.plist。
 * 打包态是 Moebius（io.tranfu.moebius），开发态是 Electron（com.github.Electron）。
 * 解析失败返回 null，调用方回退到应用身份变体。
 */
export function deriveRunningBundleId(): string | null {
  try {
    const bundlePath = path.resolve(process.execPath, "..", "..", "..");
    const plist = fs.readFileSync(path.join(bundlePath, "Contents", "Info.plist"), "utf8");
    const match = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/u.exec(plist);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function runPermissionBridge(
  executablePath: string,
  action: MacOsPermissionAction,
  timeoutMs: number,
): Promise<MacOsNotificationPermissionSnapshot> {
  return new Promise((resolve) => {
    const child = spawn(executablePath, [action], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({
        authorizationStatus: "unknown",
        alert: "unknown",
        sound: "unknown",
        badge: "unknown",
        error: `macos-permission-bridge-timeout:${timeoutMs}ms`,
      });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        authorizationStatus: "unknown",
        alert: "unknown",
        sound: "unknown",
        badge: "unknown",
        error: `macos-permission-bridge-spawn:${String(error)}`,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 桥的错误负载（{"error": "..."}）必须原样透出，设置页才能展示
      // 「暂时无法检测」而不是伪装成「尚未开启」（QA #135 FQA-03）。
      const bridgeError = tryParseBridgeError(stdout);
      if (bridgeError !== null) {
        resolve({
          authorizationStatus: "unknown",
          alert: "unknown",
          sound: "unknown",
          badge: "unknown",
          error: `macos-permission-bridge-error:${bridgeError}`,
        });
        return;
      }
      try {
        const snapshot = parseSnapshot(stdout);
        resolve({ ...snapshot, error: code === 0 ? null : `macos-permission-bridge-exit:${String(code)}:${stderr.trim()}` });
      } catch (error) {
        resolve({
          authorizationStatus: "unknown",
          alert: "unknown",
          sound: "unknown",
          badge: "unknown",
          error: `macos-permission-bridge-parse:${String(error)}:${stdout.trim()}`,
        });
      }
    });
  });
}

function tryParseBridgeError(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { error?: unknown };
    return typeof parsed.error === "string" && parsed.error.length > 0 ? parsed.error : null;
  } catch {
    return null;
  }
}

/** 打包态可执行位于 Contents/Resources/native；开发态使用 desktop/native/build 产物。 */
export function createMacOsPermissionAdapter(input: {
  executablePath: string;
  timeoutMs?: number;
}): MacOsPermissionAdapter {
  const timeoutMs = input.timeoutMs ?? 5_000;
  return {
    read: () => runPermissionBridge(input.executablePath, "status", timeoutMs),
    request: () => runPermissionBridge(input.executablePath, "request", timeoutMs),
  };
}
