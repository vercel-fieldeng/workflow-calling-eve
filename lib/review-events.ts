import { z } from 'zod'
import type { MessageStreamEvent } from 'eve/client'
import type { AgentAnalysis } from './review-types'

export const analysisSchema = z.object({
  summary: z.string().min(1).max(400),
  points: z.array(z.string().min(1).max(1200)).min(1).max(8),
  assumptions: z.array(z.string().min(1).max(1200)).max(8),
})

export interface ReviewAccumulator {
  message: string | null
  analysis: AgentAnalysis | null
  terminal: boolean
  error: string | null
}

export function reduceReviewEvent(previous: ReviewAccumulator, event: MessageStreamEvent): ReviewAccumulator {
  const state = { ...previous }
  switch (event.type) {
    case 'message.completed':
      if (event.data.finishReason !== 'tool-calls') state.message = event.data.message
      break
    case 'result.completed': {
      const parsed = analysisSchema.safeParse(event.data.result)
      state.analysis = parsed.success ? parsed.data : null
      break
    }
    case 'input.requested':
    case 'authorization.required':
      state.terminal = true
      state.error = 'The agent requested human input. This unattended demo cannot continue that turn.'
      break
    case 'session.failed':
      state.terminal = true
      state.error = 'The eve session failed. Inspect its session ID in the runtime logs.'
      break
    case 'turn.cancelled':
      state.terminal = true
      state.error = 'The agent turn was cancelled.'
      break
    case 'session.completed':
    case 'session.waiting':
      state.terminal = true
      if (!state.analysis && !state.error) state.error = 'The agent finished without a valid structured analysis.'
      break
  }
  return state
}
