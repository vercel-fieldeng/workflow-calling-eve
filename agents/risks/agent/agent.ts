import { defineAgent } from "eve";

// Minimal, unattended analysis agent. Identity comes from the mount alias
// ("risks") in next.config.mjs; do NOT add a `name` field here.
export default defineAgent({
  model: "anthropic/claude-haiku-4.5",
  defaultTools: false,
  limits: {
    maxInputTokensPerSession: 60_000,
    maxOutputTokensPerSession: 4_000,
    sessionTimeoutMs: 10 * 60 * 1_000,
  },
});
