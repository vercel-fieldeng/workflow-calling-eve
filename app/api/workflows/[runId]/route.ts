import { NextResponse } from 'next/server'
import { getWorld } from 'workflow/runtime'
import { WorkflowRunNotFoundError } from 'workflow/errors'
import { hydrateResourceIO, observabilityRevivers, parseWorkflowName } from 'workflow/observability'
import { AGENT_NAMES } from '@/lib/review-types'
import { baseStatus, buildLiveBranches, deriveOverall, parseTerminalReturnValue, toEpochMs } from '@/lib/workflow-run-status'

export const runtime = 'nodejs'
const RUN_ID_RE = /^wrun_[A-Za-z0-9]{26}$/
const responseHeaders = { 'Cache-Control': 'no-store' }

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  if (!RUN_ID_RE.test(runId)) return NextResponse.json({ error: 'Invalid workflow run ID.' }, { status: 400 })
  try {
    const world = await getWorld()
    const run = await world.runs.get(runId, { resolveData: 'all' })
    const name = parseWorkflowName(run.workflowName)
    // eve session runs share storage with outer workflows. Do not expose them here.
    if (name?.functionName !== 'parallelReviewWorkflow' || name.moduleSpecifier.replace(/^\.\//, '') !== 'workflows/parallel-review') {
      return NextResponse.json({ error: 'Review run not found.' }, { status: 404 })
    }
    const hydrated = hydrateResourceIO(run, observabilityRevivers)
    const proposal = Array.isArray(hydrated.input) && typeof hydrated.input[0] === 'string' ? hydrated.input[0] : ''
    const startedAt = toEpochMs(run.startedAt) ?? toEpochMs(run.createdAt) ?? 0
    if (run.status === 'completed') {
      const result = parseTerminalReturnValue(runId, hydrated.output)
      if (result) return NextResponse.json(result, { headers: responseHeaders })
      const invalid = baseStatus(runId, 'failed', proposal, startedAt)
      invalid.workflowError = 'The workflow returned an invalid result.'
      invalid.finishedAt = toEpochMs(run.completedAt)
      return NextResponse.json(invalid, { headers: responseHeaders })
    }

    const branches = await buildLiveBranches(world, runId)
    if (run.status === 'failed' || run.status === 'cancelled') {
      for (const agent of AGENT_NAMES) {
        if (!['completed', 'failed', 'timeout'].includes(branches[agent].status)) {
          branches[agent].status = 'failed'
          branches[agent].error = `The outer workflow ${run.status} before this branch finished.`
          branches[agent].finishedAt = toEpochMs(run.completedAt)
        }
      }
      const derived = deriveOverall(branches.benefits, branches.risks)
      return NextResponse.json({
        runId, proposal, startedAt, branches,
        overall: derived.overall === 'completed' ? 'failed' : derived.overall,
        finishedAt: toEpochMs(run.completedAt),
        workflowError: `The workflow ${run.status}. Use the run ID to inspect runtime logs.`,
      }, { headers: responseHeaders })
    }
    return NextResponse.json({
      runId, proposal, startedAt, branches,
      overall: run.status === 'pending' ? 'queued' : 'running',
      finishedAt: null,
      workflowError: null,
    }, { headers: responseHeaders })
  } catch (error) {
    if (WorkflowRunNotFoundError.is(error)) return NextResponse.json({ error: 'Review run not found.' }, { status: 404 })
    return NextResponse.json({ error: 'Unable to read workflow storage. Reconnect to this run to try again.' }, { status: 503 })
  }
}
