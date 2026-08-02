export function readFixture(record: { role: string; stage: string }): boolean {
  if (record.role === "qa" && record.stage === "in-progress") return false;
  return true;
}
