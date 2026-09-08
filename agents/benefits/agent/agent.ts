import { defineAgent } from "eve";

// Minimal, unattended analysis agent. Identity comes from the mount alias
// ("benefits") in next.config.mjs; do NOT add a `name` field here.
// `defaultTools: false` disables bash/read_file/write_file/web_fetch/web_search/
// todo/ask_question so the demo cannot execute commands or park for approvals.
export default defineAgent({
  model: "anthropic/claude-haiku-4.5",
  defaultTools: false,
  limits: {
    maxInputTokensPerSession: 60_000,
    maxOutputTokensPerSession: 4_000,
    sessionTimeoutMs: 10 * 60 * 1_000,
  },
});
