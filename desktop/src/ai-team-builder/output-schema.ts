export const AI_TEAM_BUILDER_OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["phase", "question", "team", "members", "primaryAgentSlug", "relayBeats"],
  properties: {
    phase: { type: "string", enum: ["clarifying", "proposal"] },
    question: {
      type: ["string", "null"],
      description: "One clarifying question when phase is clarifying; otherwise null.",
    },
    team: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["name", "purpose"],
      properties: {
        name: { type: "string", minLength: 1 },
        purpose: { type: "string", minLength: 1 },
      },
    },
    members: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slug", "name", "role", "responsibilities", "inputContract", "outputContract", "onContractViolation", "constraints", "handoffs"],
        properties: {
          slug: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
          role: { type: "string", minLength: 1 },
          responsibilities: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
          inputContract: {
            type: "array",
            description: "Inputs that must be present before this member starts, including the acceptance criteria and who can judge them; at least one entry.",
            items: { type: "string", minLength: 1 },
          },
          outputContract: {
            type: "array",
            description: "The deliverable shape and how its completion can be checked; at least one entry.",
            items: { type: "string", minLength: 1 },
          },
          onContractViolation: {
            type: "array",
            description: "Pre-agreed actions when the input contract is not met: non-primary members hand back to the primary agent stating what is missing instead of guessing; at least one entry.",
            items: { type: "string", minLength: 1 },
          },
          constraints: {
            type: "array",
            description: "Abstention and activation rules: what this member must not do, and under which conditions expensive methods may run; at least one entry.",
            items: { type: "string", minLength: 1 },
          },
          handoffs: {
            type: "array",
            description: "Only exact slug references to other members; no explanatory prose.",
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
    primaryAgentSlug: {
      type: ["string", "null"],
      description: "Exact slug of one member when phase is proposal; otherwise null.",
    },
    relayBeats: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["speakerSlug", "message"],
        properties: {
          speakerSlug: { type: "string", minLength: 1 },
          message: { type: "string", minLength: 1 },
        },
      },
    },
  },
} as const;

export function serializeAiTeamBuilderOutputSchema(): string {
  return `${JSON.stringify(AI_TEAM_BUILDER_OUTPUT_SCHEMA, null, 2)}\n`;
}
