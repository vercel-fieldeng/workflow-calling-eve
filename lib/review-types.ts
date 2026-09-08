/**
 * Shared, serializable types for the parallel-review demo.
 *
 * These types are the contract between:
 *   - the workflow steps in `workflows/parallel-review.ts`,
 *   - the API in `app/api/workflows/*`,
 *   - the UI (owned by another agent) that renders progress.
 *
 * Everything here is JSON-serializable so it can safely cross workflow/step
 * boundaries and appear verbatim in HTTP responses.
 */

export const AGENT_NAMES = ["benefits", "risks"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const PROPOSAL_MIN = 20;
export const PROPOSAL_MAX = 4_000;

/** Structured output contract enforced on each agent turn. */
export interface AgentAnalysis {
  /** One-sentence executive summary of the analysis. */
  summary: string;
  /** Bullet points. For `benefits`: advantages/opportunities. For `risks`: risks/mitigations. */
  points: string[];
  /** Assumptions the agent had to make about missing information. */
  assumptions: string[];
}

/** Terminal state for a single branch. */
export type BranchStatus =
  | "queued"
  | "admitted"
  | "running"
  | "completed"
  | "failed"
  | "timeout";

export interface BranchResult {
  agent: AgentName;
  status: BranchStatus;
  /** eve session id, present once admission succeeds. */
  sessionId: string | null;
  /** Structured analysis, present when status === "completed". */
  analysis: AgentAnalysis | null;
  /** Final assistant text from the eve turn, if any. */
  message: string | null;
  /** Sanitized error message when failed/timeout. */
  error: string | null;
  /** ms epoch when admission POST returned. */
  admittedAt: number | null;
  /** ms epoch when the branch reached a terminal state. */
  finishedAt: number | null;
  /** Total wall time from admission to terminal, in ms. */
  durationMs: number | null;
}

export type ReviewOverallStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial_failure"
  | "failed";

/** Top-level status shape returned by `GET /api/workflows/[runId]`. */
export interface ReviewStatus {
  runId: string;
  overall: ReviewOverallStatus;
  /** Original proposal text (trimmed, length-bounded). */
  proposal: string;
  /** ms epoch when the workflow was accepted. */
  startedAt: number;
  /** ms epoch when both branches reached a terminal state, or null. */
  finishedAt: number | null;
  branches: {
    benefits: BranchResult;
    risks: BranchResult;
  };
  /** Present only if the workflow itself failed before/around fan-out. */
  workflowError: string | null;
}

export function emptyBranch(agent: AgentName): BranchResult {
  return {
    agent,
    status: "queued",
    sessionId: null,
    analysis: null,
    message: null,
    error: null,
    admittedAt: null,
    finishedAt: null,
    durationMs: null,
  };
}
