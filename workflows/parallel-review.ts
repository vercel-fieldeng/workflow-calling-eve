import { sleep, FatalError } from "workflow";
import { z } from "zod";
import type { MessageStreamEvent } from "eve/client";

import {
  type AgentName,
  type AgentAnalysis,
  type BranchResult,
  type BranchStatus,
  type ReviewStatus,
  type ReviewOverallStatus,
  emptyBranch,
  PROPOSAL_MIN,
  PROPOSAL_MAX,
} from "@/lib/review-types";
import { createReviewClient } from "@/lib/eve-review-client";

// Output schema the two agents are required to satisfy on every turn.
const analysisSchema = z.object({
  summary: z.string().min(1).max(400),
  points: z.array(z.string().min(1)).min(1).max(8),
  assumptions: z.array(z.string().min(1)).max(8),
});

// Bounded polling parameters. A single turn should settle in well under this,
// but we cap it so a stuck branch cannot hold the workflow open forever.
const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_ITERATIONS = 45; // ~90s per branch

const TERMINAL_TYPES = new Set([
  "session.completed",
  "session.failed",
  "session.waiting",
  "turn.cancelled",
]);

interface AdmissionResult {
  sessionId: string;
  admittedAt: number;
}

interface PollResult {
  terminal: boolean;
  status: BranchStatus;
  message: string | null;
  analysis: AgentAnalysis | null;
  error: string | null;
  newStreamIndex: number;
  observedAt: number;
}

/**
 * Step: admit a new eve session with the first (and only) turn.
 *
 * eve session creation is NOT idempotent — a retry here would create a second
 * duplicate session and spend model tokens twice. We therefore mark every
 * failure as `FatalError` so the workflow surfaces the admission error instead
 * of transparently retrying.
 */
async function admitBranch(agent: AgentName, proposal: string): Promise<AdmissionResult> {
  "use step";
  const client = createReviewClient(agent);
  try {
    const { session, response } = await client.sessions.create({
      message: proposal,
      outputSchema: analysisSchema,
    });
    // We don't consume `response` here; the durable session runs on its own and
    // the next step attaches by ID to read its stream.
    void response;
    return {
      sessionId: session.state.sessionId,
      admittedAt: Date.now(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FatalError(`[${agent}] admission failed: ${message}`);
  }
}

/**
 * Step: bounded catch-up read on the durable eve session stream.
 *
 * Attaches by ID, drains events currently on the durable tail with
 * `follow: false`, and reports the accumulated terminal state. If the turn
 * hasn't settled yet, `terminal: false` is returned and the workflow sleeps.
 * A step-level failure here is safe to retry (attach performs no I/O; the
 * bounded read only observes existing events).
 */
async function pollBranch(
  agent: AgentName,
  sessionId: string,
  startIndex: number,
): Promise<PollResult> {
  "use step";
  const client = createReviewClient(agent);
  const session = client.sessions.attach(sessionId, { streamIndex: startIndex });

  const collected: MessageStreamEvent[] = [];
  let terminalType: string | null = null;

  try {
    for await (const event of session.stream({ follow: false })) {
      collected.push(event);
      if (TERMINAL_TYPES.has(event.type)) {
        terminalType = event.type;
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      terminal: false,
      status: "running",
      message: null,
      analysis: null,
      error: `poll error: ${message}`,
      newStreamIndex: session.state.streamIndex,
      observedAt: Date.now(),
    };
  }

  const newStreamIndex = session.state.streamIndex;

  if (terminalType === null) {
    return {
      terminal: false,
      status: startIndex === 0 && collected.length === 0 ? "admitted" : "running",
      message: null,
      analysis: null,
      error: null,
      newStreamIndex,
      observedAt: Date.now(),
    };
  }

  // Extract final assistant message and structured output (last of each kind).
  let message: string | null = null;
  let analysis: AgentAnalysis | null = null;
  let failureReason: string | null = null;

  for (const event of collected) {
    if (event.type === "message.appended") {
      message = (message ?? "") + (event as { data: { messageDelta: string } }).data.messageDelta;
    } else if (event.type === "result.completed") {
      const data = (event as { data: { result: unknown } }).data.result;
      const parsed = analysisSchema.safeParse(data);
      if (parsed.success) analysis = parsed.data;
    } else if (event.type === "session.failed") {
      const data = (event as { data?: { error?: { message?: string } } }).data;
      failureReason = data?.error?.message ?? "session.failed";
    } else if (event.type === "turn.cancelled") {
      failureReason = failureReason ?? "turn.cancelled";
    }
  }

  let status: BranchStatus;
  if (terminalType === "session.completed" || terminalType === "session.waiting") {
    status = analysis || message ? "completed" : "failed";
    if (status === "failed" && failureReason === null) {
      failureReason = "no structured output or message emitted";
    }
  } else {
    status = "failed";
  }

  return {
    terminal: true,
    status,
    message,
    analysis,
    error: status === "failed" ? failureReason ?? terminalType : null,
    newStreamIndex,
    observedAt: Date.now(),
  };
}

/**
 * One branch: admit, then poll to a terminal state or timeout.
 * Runs at the workflow scope (uses `sleep`), not as a step.
 */
async function runBranch(agent: AgentName, proposal: string): Promise<BranchResult> {
  const branch: BranchResult = emptyBranch(agent);

  let admission: AdmissionResult;
  try {
    admission = await admitBranch(agent, proposal);
  } catch (err) {
    branch.status = "failed";
    branch.error = err instanceof Error ? err.message : String(err);
    branch.finishedAt = Date.now();
    return branch;
  }

  branch.sessionId = admission.sessionId;
  branch.admittedAt = admission.admittedAt;
  branch.status = "admitted";

  let cursor = 0;
  for (let i = 0; i < POLL_MAX_ITERATIONS; i++) {
    const poll = await pollBranch(agent, admission.sessionId, cursor);
    cursor = poll.newStreamIndex;

    if (poll.terminal) {
      branch.status = poll.status;
      branch.message = poll.message;
      branch.analysis = poll.analysis;
      branch.error = poll.error;
      branch.finishedAt = poll.observedAt;
      branch.durationMs = poll.observedAt - admission.admittedAt;
      return branch;
    }

    if (poll.status === "running") branch.status = "running";
    await sleep(`${POLL_INTERVAL_MS}ms`);
  }

  branch.status = "timeout";
  branch.error = `no terminal event within ${POLL_MAX_ITERATIONS * POLL_INTERVAL_MS}ms`;
  branch.finishedAt = Date.now();
  branch.durationMs = branch.finishedAt - admission.admittedAt;
  return branch;
}

function deriveOverall(
  b: BranchResult,
  r: BranchResult,
): { overall: ReviewOverallStatus; finishedAt: number | null } {
  const done = (s: BranchStatus) =>
    s === "completed" || s === "failed" || s === "timeout";
  const allDone = done(b.status) && done(r.status);
  const finishedAt = allDone
    ? Math.max(b.finishedAt ?? 0, r.finishedAt ?? 0) || Date.now()
    : null;

  if (!allDone) {
    if (b.status === "queued" && r.status === "queued") {
      return { overall: "queued", finishedAt };
    }
    return { overall: "running", finishedAt };
  }
  const bad = (s: BranchStatus) => s === "failed" || s === "timeout";
  if (bad(b.status) && bad(r.status)) return { overall: "failed", finishedAt };
  if (bad(b.status) || bad(r.status)) return { overall: "partial_failure", finishedAt };
  return { overall: "completed", finishedAt };
}

/**
 * Entry point. Fans out both branches concurrently at the workflow scope so
 * their admission POSTs and their polling steps overlap. `Promise.allSettled`
 * preserves one successful branch when the other throws unexpectedly (the
 * inner functions catch, so this is defense-in-depth).
 */
export async function parallelReviewWorkflow(proposal: string): Promise<ReviewStatus> {
  "use workflow";

  const startedAt = Date.now();
  const trimmed = typeof proposal === "string" ? proposal.trim() : "";
  if (trimmed.length < PROPOSAL_MIN || trimmed.length > PROPOSAL_MAX) {
    throw new FatalError(
      `proposal must be ${PROPOSAL_MIN}–${PROPOSAL_MAX} chars (got ${trimmed.length})`,
    );
  }

  const settled = await Promise.allSettled([
    runBranch("benefits", trimmed),
    runBranch("risks", trimmed),
  ]);

  const materialize = (agent: AgentName, r: PromiseSettledResult<BranchResult>): BranchResult => {
    if (r.status === "fulfilled") return r.value;
    const branch = emptyBranch(agent);
    branch.status = "failed";
    branch.error = r.reason instanceof Error ? r.reason.message : String(r.reason);
    branch.finishedAt = Date.now();
    return branch;
  };

  const benefits = materialize("benefits", settled[0]);
  const risks = materialize("risks", settled[1]);
  const { overall, finishedAt } = deriveOverall(benefits, risks);

  const status: ReviewStatus = {
    runId: "", // set by the API layer from the workflow run id
    overall,
    proposal: trimmed,
    startedAt,
    finishedAt,
    branches: { benefits, risks },
    workflowError: null,
  };
  return status;
}
