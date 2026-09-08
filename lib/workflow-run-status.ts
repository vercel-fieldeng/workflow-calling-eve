/**
 * Server-only helpers for `GET /api/workflows/[runId]`.
 *
 * Wraps the low-level `workflow/runtime` World SDK: hydrating step I/O,
 * reconstructing live per-agent branch progress from durable step records,
 * validating terminal return values, and sanitizing error text before it
 * reaches the wire.
 */
import { z } from "zod";
import type { getWorld } from "workflow/runtime";
import { hydrateResourceIO, observabilityRevivers, parseStepName } from "workflow/observability";

import {
  AGENT_NAMES,
  emptyBranch,
  type AgentName,
  type BranchResult,
  type BranchStatus,
  type ReviewOverallStatus,
  type ReviewStatus,
} from "@/lib/review-types";

type World = Awaited<ReturnType<typeof getWorld>>;

const MAX_ERROR_LEN = 300;
const MAX_STEP_PAGES = 50;

/** Structured errors from the World SDK carry a stack; never forward it. */
export function sanitizeError(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  let text: string;
  if (typeof input === "object" && input !== null && "message" in input) {
    text = String((input as { message: unknown }).message);
  } else if (input instanceof Error) {
    text = input.message;
  } else if (typeof input === "string") {
    text = input;
  } else {
    try {
      text = JSON.stringify(input);
    } catch {
      text = String(input);
    }
  }
  text = text.split("\n")[0]?.trim() ?? "";
  if (text.length === 0) return "unknown error";
  return text.length > MAX_ERROR_LEN ? `${text.slice(0, MAX_ERROR_LEN)}…` : text;
}

export function toEpochMs(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function baseStatus(
  runId: string,
  overall: ReviewOverallStatus,
  proposal = "",
  startedAt = 0,
): ReviewStatus {
  return {
    runId,
    overall,
    proposal,
    startedAt,
    finishedAt: null,
    branches: { benefits: emptyBranch("benefits"), risks: emptyBranch("risks") },
    workflowError: null,
  };
}

export function deriveOverall(
  benefits: BranchResult,
  risks: BranchResult,
): { overall: ReviewOverallStatus; finishedAt: number | null } {
  const done = (s: BranchStatus) => s === "completed" || s === "failed" || s === "timeout";
  const allDone = done(benefits.status) && done(risks.status);
  const finishedAt = allDone
    ? Math.max(benefits.finishedAt ?? 0, risks.finishedAt ?? 0) || Date.now()
    : null;

  if (!allDone) {
    if (benefits.status === "queued" && risks.status === "queued") {
      return { overall: "queued", finishedAt };
    }
    return { overall: "running", finishedAt };
  }
  const bad = (s: BranchStatus) => s === "failed" || s === "timeout";
  if (bad(benefits.status) && bad(risks.status)) return { overall: "failed", finishedAt };
  if (bad(benefits.status) || bad(risks.status)) return { overall: "partial_failure", finishedAt };
  return { overall: "completed", finishedAt };
}

// Runtime validation for the workflow's terminal return value. Never trust a
// stored blob to already match the TS contract.
const analysisSchema = z.object({
  summary: z.string(),
  points: z.array(z.string()),
  assumptions: z.array(z.string()),
});

const branchResultSchema = z.object({
  agent: z.enum(AGENT_NAMES),
  status: z.enum(["queued", "admitted", "running", "completed", "failed", "timeout"]),
  sessionId: z.string().nullable(),
  analysis: analysisSchema.nullable(),
  message: z.string().nullable(),
  error: z.string().nullable(),
  admittedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  durationMs: z.number().nullable(),
});

const reviewStatusSchema = z.object({
  runId: z.string(),
  overall: z.enum(["queued", "running", "completed", "partial_failure", "failed"]),
  proposal: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  branches: z.object({
    benefits: branchResultSchema,
    risks: branchResultSchema,
  }),
  workflowError: z.string().nullable(),
});

/** Validates a hydrated workflow return value; `null` if it doesn't match the contract. */
export function parseTerminalReturnValue(runId: string, value: unknown): ReviewStatus | null {
  const parsed = reviewStatusSchema.safeParse(value);
  if (!parsed.success) return null;
  return { ...parsed.data, runId };
}

interface HydratedStep {
  functionName: string | null;
  status: string;
  input: unknown;
  output: unknown;
  error: unknown;
  startedAt: number | null;
  completedAt: number | null;
}

function stepAgent(input: unknown): AgentName | null {
  const candidate = Array.isArray(input) ? input[0] : undefined;
  return (AGENT_NAMES as readonly string[]).includes(candidate as string)
    ? (candidate as AgentName)
    : null;
}

/**
 * Reconstructs live per-agent branch state from durable step records. Steps
 * for both branches share the same step function names (`admitBranch`,
 * `pollBranch`); the first argument (the agent name) is used to attribute
 * each step to its branch.
 */
export async function buildLiveBranches(
  world: World,
  runId: string,
): Promise<{ benefits: BranchResult; risks: BranchResult }> {
  const steps: HydratedStep[] = [];

  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await world.steps.list({ runId, pagination: { cursor }, resolveData: "all" });
    for (const step of page.data) {
      const hydrated = hydrateResourceIO(step, observabilityRevivers);
      const parsed = parseStepName(step.stepName);
      steps.push({
        functionName: parsed?.functionName ?? null,
        status: step.status,
        input: hydrated.input,
        output: hydrated.output,
        error: step.error ?? null,
        startedAt: toEpochMs(step.startedAt ?? null),
        completedAt: toEpochMs(step.completedAt ?? null),
      });
    }
    cursor = page.cursor ?? undefined;
    pages += 1;
  } while (cursor && pages < MAX_STEP_PAGES);

  const branches = {
    benefits: emptyBranch("benefits"),
    risks: emptyBranch("risks"),
  } satisfies Record<AgentName, BranchResult>;

  for (const agent of AGENT_NAMES) {
    const branch = branches[agent];
    const agentSteps = steps.filter((s) => stepAgent(s.input) === agent);

    const admitSteps = agentSteps
      .filter((s) => s.functionName === "admitBranch")
      .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    const admit = admitSteps.at(-1);

    if (admit) {
      if (admit.status === "completed") {
        const out = admit.output as { sessionId?: string; admittedAt?: number } | null;
        branch.status = "admitted";
        branch.sessionId = out?.sessionId ?? null;
        branch.admittedAt = out?.admittedAt ?? admit.startedAt ?? null;
      } else if (admit.status === "failed") {
        branch.status = "failed";
        branch.error = sanitizeError(admit.error);
        branch.finishedAt = admit.completedAt ?? Date.now();
      }
      // Still "running"/"pending" -> admission in flight; branch stays "queued".
    }

    const pollSteps = agentSteps
      .filter((s) => s.functionName === "pollBranch" && s.status === "completed")
      .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));

    for (const poll of pollSteps) {
      const out = poll.output as {
        terminal?: boolean;
        status?: BranchStatus;
        message?: string | null;
        analysis?: BranchResult["analysis"];
        error?: string | null;
        observedAt?: number;
      } | null;
      if (!out) continue;
      branch.message = out.message ?? branch.message;
      branch.analysis = out.analysis ?? branch.analysis;
      if (out.terminal) {
        branch.status = out.status ?? branch.status;
        branch.error = out.error ? sanitizeError(out.error) : branch.error;
        branch.finishedAt = out.observedAt ?? Date.now();
        branch.durationMs =
          branch.admittedAt && branch.finishedAt ? branch.finishedAt - branch.admittedAt : branch.durationMs;
      } else if (out.status === "running" && branch.status !== "failed") {
        branch.status = "running";
      }
    }

    const agentPollSteps = agentSteps.filter((s) => s.functionName === "pollBranch");
    const lastPoll = agentPollSteps.at(-1);
    if (lastPoll && lastPoll.status !== "completed" && branch.status !== "failed" && branch.status !== "completed") {
      // A poll request is actively in flight for this branch.
      branch.status = branch.status === "queued" ? "admitted" : "running";
    }
  }

  return branches;
}
