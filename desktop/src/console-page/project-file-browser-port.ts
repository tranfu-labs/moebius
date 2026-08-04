import { fetchFromBrowser } from "./browser-fetch.js";
import {
  loadFileReference,
  loadProjectFile,
  loadWorkspaceDiffFile,
  loadProjectFiles,
  loadWorkspaceDiff,
} from "./console-api-client.js";
import type { ProjectFilePort } from "./project-file-contract.js";

export const browserProjectFilePort: ProjectFilePort = {
  async readWorkspaceDiff(apiBase, sessionId) {
    return loadWorkspaceDiff({ apiBase, sessionId, fetch: fetchFromBrowser });
  },
  async readProjectFiles(apiBase, sessionId) {
    return loadProjectFiles({ apiBase, sessionId, fetch: fetchFromBrowser });
  },
  async readProjectFile(apiBase, sessionId, filePath) {
    return loadProjectFile({ apiBase, sessionId, filePath, fetch: fetchFromBrowser });
  },
  async readWorkspaceDiffFile(apiBase, sessionId, filePath) {
    return loadWorkspaceDiffFile({ apiBase, sessionId, filePath, fetch: fetchFromBrowser });
  },
  async readFileReference(apiBase, sessionId, filePath, line, column, hasExplicitLine) {
    return loadFileReference({
      apiBase,
      sessionId,
      filePath,
      line,
      column,
      hasExplicitLine,
      fetch: fetchFromBrowser,
    });
  },
};
