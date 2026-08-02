export class AiTeamWriterError extends Error {
  readonly code = "AI_TEAM_WRITE_FAILED";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AiTeamWriterError";
  }
}
