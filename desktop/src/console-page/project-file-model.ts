export function decideProjectFileAvailability(apiBase: string | null):
  | { kind: "available"; apiBase: string }
  | { kind: "unavailable"; error: Error } {
  return apiBase === null
    ? { kind: "unavailable", error: new Error("local console is unavailable") }
    : { kind: "available", apiBase };
}
