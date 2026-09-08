import { defineAgent } from 'eve'

export default defineAgent({
  model: 'anthropic/claude-haiku-4.5',
  defaultTools: false,
  limits: {
    maxInputTokensPerSession: 30_000,
    maxOutputTokensPerSession: 4_000,
    sessionTimeoutMs: 120_000,
  },
})
