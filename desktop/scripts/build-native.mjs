import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nativeDir = path.resolve(here, "../native/macos-notification-permission");
const buildDir = path.resolve(here, "../native/build");
const executable = path.join(buildDir, "macos-notification-permission");

// 权限桥依赖 macOS 专属的 UserNotifications 框架，且需要 codesign 打包 .app；
// 非 macOS 平台（如 CI 的 Linux runner）跳过桥构建，避免 swiftc 找不到框架。
if (process.platform !== "darwin") {
  console.log(`skip native bridge build on non-macOS platform (${process.platform})`);
  process.exit(0);
}

// 权限桥必须以 Moebius 自身应用身份读取/请求通知授权（QA #135 FQA-03）：
// UNUserNotificationCenter 按 bundle 标识存储授权，桥的 CFBundleIdentifier 必须与
// 通知提交身份一致，且桥必须签名——未签名或签名被破坏（签名后改 Info.plist）时
// requestAuthorization 会以 UNErrorDomain error 1 失败（已实机复验）。
//
// 双变体预签名：打包态宿主是 Moebius（io.tranfu.moebius，desktop/package.json
// build.appId）；开发态宿主是 Electron（com.github.Electron）。两种变体各自在
// 签名前写好 Info.plist，运行时按宿主身份选择，不做任何改写。
const desktopPackage = JSON.parse(
  readFileSync(path.resolve(here, "../package.json"), "utf8"),
);
const appId = typeof desktopPackage.build?.appId === "string"
  ? desktopPackage.build.appId
  : "io.tranfu.moebius";
const DEV_HOST_BUNDLE_ID = "com.github.Electron";

function buildVariant(bundleId, appName) {
  const appBundle = path.join(buildDir, appName);
  const appMacOsDir = path.join(appBundle, "Contents", "MacOS");
  mkdirSync(appMacOsDir, { recursive: true });
  // UNUserNotificationCenter 要求调用进程位于 .app bundle 内（bundleProxyForCurrentProcess）。
  writeFileSync(
    path.join(appBundle, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleName</key>
  <string>MoebiusPermissionBridge</string>
  <key>CFBundleExecutable</key>
  <string>macos-notification-permission</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
</dict>
</plist>
`,
  );
  writeFileSync(path.join(appMacOsDir, "macos-notification-permission"), "");
  execFileSync("cp", [executable, path.join(appMacOsDir, "macos-notification-permission")]);
  execFileSync("chmod", ["+x", path.join(appMacOsDir, "macos-notification-permission")]);
  // 未签名进程请求通知授权会被系统拒绝；adhoc 签名即可让 requestAuthorization
  // 弹窗与 status 读取工作（spike 实机验证）。签名必须在写入 Info.plist 之后。
  execFileSync("codesign", ["--force", "--sign", "-", "--identifier", bundleId, appBundle], { stdio: "inherit" });
  console.log(`built ${path.join(appMacOsDir, "macos-notification-permission")} (bundle id: ${bundleId})`);
}

mkdirSync(path.dirname(executable), { recursive: true });
execFileSync(
  "swiftc",
  ["-O", path.join(nativeDir, "main.swift"), "-o", executable],
  { stdio: "inherit" },
);
buildVariant(appId, "MoebiusPermissionBridge.app");
buildVariant(DEV_HOST_BUNDLE_ID, "MoebiusPermissionBridge.dev.app");
