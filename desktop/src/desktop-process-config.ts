import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { App } from "electron";

import {
  resolveDesktopDataRoot,
  resolveDesktopInstanceUserDataPath,
} from "./data-root.js";

// Electron's dev package name is the scoped `@moebius/desktop`; keep the
// user-facing app name (and name-derived default paths) identical between dev
// and packaged builds by setting it explicitly before the first
// app.getPath("userData") call below (packaged builds already read this name
// from electron-builder's productName, so this is a no-op there).
const APP_NAME = "Moebius";

export function configureDesktopProcess(input: {
  app: App;
  moduleUrl: string;
  env: NodeJS.ProcessEnv;
}): {
  dirname: string;
  projectRoot: string;
  dataRoot: string;
  seedRoot: string;
  seedTeamsRoot: string;
} {
  input.app.setName(APP_NAME);
  const dirname = path.dirname(fileURLToPath(input.moduleUrl));
  const projectRoot = path.resolve(dirname, "..", "..");
  const dataRoot = resolveDesktopDataRoot({
    env: input.env,
    isPackaged: input.app.isPackaged,
    projectRoot,
  });
  const instanceUserDataPath = resolveDesktopInstanceUserDataPath({
    dataRoot,
    packagedDefaultDataRoot: resolveDesktopDataRoot({
      env: {},
      isPackaged: true,
      projectRoot,
    }),
    defaultUserDataPath: input.app.getPath("userData"),
  });
  if (instanceUserDataPath !== input.app.getPath("userData")) {
    fs.mkdirSync(instanceUserDataPath, { recursive: true });
    input.app.setPath("userData", instanceUserDataPath);
  }
  if (!input.app.isPackaged && !input.app.commandLine.hasSwitch("remote-debugging-port")) {
    input.app.commandLine.appendSwitch("remote-debugging-port", "9222");
  }
  const seedRoot = input.app.isPackaged
    ? path.join(process.resourcesPath, "seed")
    : projectRoot;
  return {
    dirname,
    projectRoot,
    dataRoot,
    seedRoot,
    seedTeamsRoot: input.app.isPackaged
      ? path.join(seedRoot, "teams")
      : path.join(projectRoot, "seeds", "teams"),
  };
}
