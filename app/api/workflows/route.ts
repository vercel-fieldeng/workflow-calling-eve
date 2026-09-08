import { NextResponse } from "next/server";
import { z } from "zod";
import { start } from "workflow/api";

import { parallelReviewWorkflow } from "@/workflows/parallel-review";
import { PROPOSAL_MAX, PROPOSAL_MIN } from "@/lib/review-types";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;

const bodySchema = z.object({
  proposal: z.string().min(PROPOSAL_MIN).max(PROPOSAL_MAX),
});

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const proposal = parsed.data.proposal.trim();
  if (proposal.length < PROPOSAL_MIN) {
    return NextResponse.json(
      { error: `proposal must be at least ${PROPOSAL_MIN} non-whitespace chars` },
      { status: 400 },
    );
  }

  let runId: string;
  try {
    const run = await start(parallelReviewWorkflow, [proposal]);
    runId = run.runId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "failed to start workflow", detail: message },
      { status: 500 },
    );
  }

  const statusUrl = new URL(`/api/workflows/${runId}`, request.url).toString();
  return NextResponse.json({ runId, statusUrl }, { status: 202 });
}
