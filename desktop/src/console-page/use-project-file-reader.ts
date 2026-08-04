import { useCallback, useMemo, useRef } from "react";

import type { ProjectFilePort } from "./project-file-contract.js";
import { decideProjectFileAvailability } from "./project-file-model.js";

export function useProjectFileReader(apiBase: string | null, port: ProjectFilePort) {
  const inputRef = useRef({ apiBase, port });
  inputRef.current = { apiBase, port };

  const readWorkspaceDiff = useCallback((sessionId: string) => {
    const current = inputRef.current;
    const availability = decideProjectFileAvailability(current.apiBase);
    if (availability.kind === "unavailable") return Promise.reject(availability.error);
    return current.port.readWorkspaceDiff(availability.apiBase, sessionId);
  }, []);

  const readProjectFiles = useCallback((sessionId: string) => {
    const current = inputRef.current;
    const availability = decideProjectFileAvailability(current.apiBase);
    if (availability.kind === "unavailable") return Promise.reject(availability.error);
    return current.port.readProjectFiles(availability.apiBase, sessionId);
  }, []);

  const readProjectFile = useCallback((sessionId: string, filePath: string) => {
    const current = inputRef.current;
    const availability = decideProjectFileAvailability(current.apiBase);
    if (availability.kind === "unavailable") return Promise.reject(availability.error);
    return current.port.readProjectFile(availability.apiBase, sessionId, filePath);
  }, []);

  const readWorkspaceDiffFile = useCallback((sessionId: string, filePath: string) => {
    const current = inputRef.current;
    const availability = decideProjectFileAvailability(current.apiBase);
    if (availability.kind === "unavailable") return Promise.reject(availability.error);
    return current.port.readWorkspaceDiffFile(availability.apiBase, sessionId, filePath);
  }, []);

  const readFileReference = useCallback((
    sessionId: string,
    filePath: string,
    line: number,
    column: number | null,
    hasExplicitLine: boolean,
  ) => {
    const current = inputRef.current;
    const availability = decideProjectFileAvailability(current.apiBase);
    if (availability.kind === "unavailable") return Promise.reject(availability.error);
    return current.port.readFileReference(
      availability.apiBase,
      sessionId,
      filePath,
      line,
      column,
      hasExplicitLine,
    );
  }, []);

  return useMemo(() => ({
    readWorkspaceDiff,
    readProjectFiles,
    readProjectFile,
    readWorkspaceDiffFile,
    readFileReference,
  }), [readFileReference, readProjectFile, readProjectFiles, readWorkspaceDiff, readWorkspaceDiffFile]);
}
