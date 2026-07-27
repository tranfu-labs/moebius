import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createAcceptanceOutputDirectory(scope: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(scope)) {
    throw new Error(`Invalid acceptance output scope: ${scope}`);
  }
  return fs.mkdtemp(path.join(os.tmpdir(), `moebius-${scope}-`));
}
