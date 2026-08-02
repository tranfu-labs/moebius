import fs from "node:fs/promises";

export async function readOptionalTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function directoryAvailable(folderPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(folderPath);
    if (!stat.isDirectory()) return false;
    await fs.access(folderPath);
    return true;
  } catch {
    return false;
  }
}

export async function fileAvailable(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}
