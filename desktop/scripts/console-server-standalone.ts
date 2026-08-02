import { startLocalConsoleServer } from "../../src/local-console/start.js";

const host = process.env.WEB_SHELL_LOCAL_CONSOLE_HOST ?? "127.0.0.1";
const port = Number(process.env.WEB_SHELL_LOCAL_CONSOLE_PORT ?? 5181);
const sqlitePath = process.env.WEB_SHELL_LOCAL_CONSOLE_SQLITE;
const workdirRoot = process.env.WEB_SHELL_LOCAL_CONSOLE_WORKDIR;
const projectRoot = process.env.WEB_SHELL_LOCAL_CONSOLE_PROJECT_ROOT;

const started = await startLocalConsoleServer({
  host,
  port,
  sqlitePath,
  workdirRoot,
  projectRoot,
});

console.log(`[console-server-standalone] listening on ${started.url}`);
console.log(`[console-server-standalone] sqlite=${started.sqlitePath}`);

const shutdown = async (): Promise<void> => {
  await started.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
