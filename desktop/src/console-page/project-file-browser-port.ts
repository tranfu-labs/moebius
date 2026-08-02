import { fetchFromBrowser } from "./browser-fetch.js";
import {
  loadFileReference,
  loadProjectFile,
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
  async readFileReference(apiBase, sessionId, filePath, line, column) {
    return loadFileReference({ apiBase, sessionId, filePath, line, column, fetch: fetchFromBrowser });
  },
};
