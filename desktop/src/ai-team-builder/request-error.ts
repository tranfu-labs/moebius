export class AiTeamBuilderRequestError extends Error {
  readonly code = "AI_TEAM_BUILDER_REQUEST_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AiTeamBuilderRequestError";
  }
}
