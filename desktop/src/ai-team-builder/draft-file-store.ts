import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { AiTeamBuilderDraftFilePort } from "./draft-store-contract.js";
import type { AiTeamBuilderDraft } from "./state-machine.js";

export class AiTeamBuilderDraftFileStore implements AiTeamBuilderDraftFilePort {
  private readonly draftsRoot: string;

  constructor(dataRoot: string) {
    this.draftsRoot = path.join(
      path.resolve(dataRoot),
      ".state",
      "ai-team-builder-drafts",
    );
  }

  async read(draftId: string): Promise<string | null> {
    try {
      return await fs.readFile(this.getDraftPath(draftId), "utf8");
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
      return null;
    }
  }

  async write(draft: AiTeamBuilderDraft): Promise<void> {
    const draftPath = this.getDraftPath(draft.draftId);
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    const temporaryPath = `${draftPath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
      await fs.rename(temporaryPath, draftPath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private getDraftPath(draftId: string): string {
    return path.join(this.draftsRoot, `${draftId}.json`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
