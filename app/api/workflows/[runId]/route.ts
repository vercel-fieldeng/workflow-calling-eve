import { NextResponse } from "next/server";
import { getRun } from "workflow/api";

import {
  emptyBranch,
  type ReviewStatus,
  type ReviewOverallStatus,
} from "@/lib/review-types";

export const runtime = "nodejs";

const RUN_ID_RE = /^[A-Za-z0-9_-]{6,128}$/;

function baseStatus(runId: string, overall: ReviewOverallStatus): ReviewStatus {
  return {
    runId,
    overall,
    proposal: "",
    startedAt: 0,
    finishedAt: null,
    branches: { benefits: emptyBranch("benefits"), risks: emptyBranch("risks") },
    workflowError: null,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  if (!runId || !RUN_ID_RE.test(runId)) {
    return NextResponse.json({ error: "invalid runId" }, { status: 400 });
  }

  const run = getRun(runId);

  if (!(await run.exists)) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  let status: string;
  try {
    status = await run.status;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "failed to read run status", detail: message }, { status: 502 });
  }

  // Terminal? Return the workflow's real return value.
  if (status === "completed") {
    try {
      const value = (await run.returnValue) as ReviewStatus | undefined;
      const materialized: ReviewStatus = value
        ? { ...value, runId }
        : baseStatus(runId, "completed");
      return NextResponse.json(materialized, { status: 200 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const out = baseStatus(runId, "failed");
      out.workflowError = `failed to read return value: ${message}`;
      return NextResponse.json(out, { status: 200 });
    }
  }

  if (status === "failed" || status === "cancelled") {
    const out = baseStatus(runId, "failed");
    out.workflowError = `workflow ${status}`;
    return NextResponse.json(out, { status: 200 });
  }

  // Still running — we do not expose partial step I/O to callers by default.
  // The UI polls until the workflow settles.
  const out = baseStatus(runId, "running");
  return NextResponse.json(out, { status: 200 });
}
