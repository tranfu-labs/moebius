export function executeFixture(message: { role: string }): string {
  if (message.role === "qa") return "qa";
  return "other";
}
