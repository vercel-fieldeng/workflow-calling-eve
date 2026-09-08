import { sleep, FatalError, getWorkflowMetadata } from 'workflow'
import { createReviewClient } from '@/lib/eve-review-client'
import { analysisSchema, reduceReviewEvent, type ReviewAccumulator } from '@/lib/review-events'
import { emptyBranch, PROPOSAL_MIN, PROPOSAL_MAX, type AgentName, type BranchResult, type ReviewStatus } from '@/lib/review-types'

async function admitBranch(agent: AgentName, proposal: string) {
  'use step'
  try {
    const client = createReviewClient(agent)
    const { session } = await client.sessions.create({
      message: proposal,
      outputSchema: analysisSchema,
      signal: AbortSignal.timeout(15_000),
    })
    return { sessionId: session.state.sessionId, admittedAt: Date.now() }
  } catch {
    // Admission has no idempotency key. Never retry an ambiguous POST.
    throw new FatalError('Session admission failed. A request may have reached eve; it was not retried automatically.')
  }
}
admitBranch.maxRetries = 0

async function pollBranch(agent: AgentName, sessionId: string, startIndex: number, previous: ReviewAccumulator) {
  'use step'
  const session = createReviewClient(agent).sessions.attach(sessionId, { streamIndex: startIndex })
  let state = previous
  for await (const event of session.stream({
    follow: false,
    signal: AbortSignal.timeout(10_000),
    streamReconnectPolicy: { reconnect: false },
  })) {
    state = reduceReviewEvent(state, event)
    if (state.terminal) break
  }
  return {
    ...state,
    status: state.terminal ? state.error ? 'failed' as const : 'completed' as const : 'running' as const,
    newStreamIndex: session.state.streamIndex,
    observedAt: Date.now(),
  }
}
pollBranch.maxRetries = 2

async function retireBranch(agent: AgentName, sessionId: string) {
  'use step'
  try {
    await createReviewClient(agent).sessions.attach(sessionId).reset({
      reason: 'The single-turn review branch has finished.',
      signal: AbortSignal.timeout(5_000),
    })
    return { retired: true }
  } catch {
    // Agent-level timeout is the fallback if cleanup cannot reach the session.
    return { retired: false }
  }
}

async function runBranch(agent: AgentName, proposal: string): Promise<BranchResult> {
  const branch = emptyBranch(agent)
  let cursor = 0
  let state: ReviewAccumulator = { message: null, analysis: null, terminal: false, error: null }
  try {
    const admission = await admitBranch(agent, proposal)
    branch.sessionId = admission.sessionId
    branch.admittedAt = admission.admittedAt
    branch.status = 'running'

    for (let attempt = 0; attempt < 45; attempt++) {
      const poll = await pollBranch(agent, admission.sessionId, cursor, state)
      cursor = poll.newStreamIndex
      state = { message: poll.message, analysis: poll.analysis, terminal: poll.terminal, error: poll.error }
      branch.message = state.message
      branch.analysis = state.analysis
      if (poll.terminal) {
        branch.status = poll.status
        branch.error = poll.error
        branch.finishedAt = poll.observedAt
        branch.durationMs = poll.observedAt - admission.admittedAt
        await retireBranch(agent, admission.sessionId)
        return branch
      }
      if (poll.observedAt - admission.admittedAt >= 90_000) break
      // A persisted absolute time avoids parallel branches shifting relative sleeps during replay.
      await sleep(new Date(poll.observedAt + 2_000))
    }
    branch.status = 'timeout'
    branch.error = 'The agent did not finish within the 90-second review window.'
  } catch {
    branch.status = 'failed'
    branch.error = branch.sessionId
      ? 'Unable to collect the agent result after bounded retries. The other branch continues.'
      : 'Session admission failed. It was not retried because the original request may have reached eve.'
  }
  branch.finishedAt = Date.now()
  branch.durationMs = branch.admittedAt ? branch.finishedAt - branch.admittedAt : null
  if (branch.sessionId) await retireBranch(agent, branch.sessionId)
  return branch
}

export async function parallelReviewWorkflow(proposal: string): Promise<ReviewStatus> {
  'use workflow'
  const startedAt = Date.now()
  const trimmed = typeof proposal === 'string' ? proposal.trim() : ''
  if (trimmed.length < PROPOSAL_MIN || trimmed.length > PROPOSAL_MAX) {
    throw new FatalError('Proposal length is outside the allowed range.')
  }

  const settled = await Promise.allSettled([
    runBranch('benefits', trimmed),
    runBranch('risks', trimmed),
  ])
  const materialize = (agent: AgentName, result: PromiseSettledResult<BranchResult>): BranchResult => {
    if (result.status === 'fulfilled') return result.value
    return { ...emptyBranch(agent), status: 'failed', error: 'The branch could not complete.', finishedAt: Date.now() }
  }
  const benefits = materialize('benefits', settled[0])
  const risks = materialize('risks', settled[1])
  const successes = [benefits, risks].filter(branch => branch.status === 'completed').length
  return {
    runId: getWorkflowMetadata().workflowRunId,
    overall: successes === 2 ? 'completed' : successes === 1 ? 'partial_failure' : 'failed',
    proposal: trimmed,
    startedAt,
    finishedAt: Math.max(benefits.finishedAt ?? 0, risks.finishedAt ?? 0),
    branches: { benefits, risks },
    workflowError: null,
  }
}
