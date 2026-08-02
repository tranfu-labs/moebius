import fs from "node:fs/promises";

export async function readTeamDirectoryCreatedAt(directory: string): Promise<string | null> {
  const stats = await fs.stat(directory).catch(() => null);
  if (stats === null) return null;
  return (stats.birthtimeMs > 0 ? stats.birthtime : stats.ctime).toISOString();
}
