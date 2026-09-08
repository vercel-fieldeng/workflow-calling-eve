import { NextResponse } from 'next/server'
import { z } from 'zod'
import { start } from 'workflow/api'
import { parallelReviewWorkflow } from '@/workflows/parallel-review'
import { PROPOSAL_MAX, PROPOSAL_MIN } from '@/lib/review-types'

export const runtime = 'nodejs'
const MAX_BODY_BYTES = 16 * 1024
const bodySchema = z.object({ proposal: z.string().trim().min(PROPOSAL_MIN).max(PROPOSAL_MAX) }).strict()

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Send an application/json request body.' }, { status: 415 })
  }
  const reader = request.body?.getReader()
  if (!reader) return NextResponse.json({ error: 'A proposal is required.' }, { status: 400 })
  let raw: unknown
  try {
    const decoder = new TextDecoder()
    let bytes = 0
    let text = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel()
        return NextResponse.json({ error: 'Request body exceeds 16 KB.' }, { status: 413 })
      }
      text += decoder.decode(value, { stream: true })
    }
    raw = JSON.parse(text + decoder.decode())
  } catch {
    return NextResponse.json({ error: 'The request body must contain valid JSON.' }, { status: 400 })
  } finally {
    reader.releaseLock()
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: `Provide only a proposal between ${PROPOSAL_MIN} and ${PROPOSAL_MAX} characters.` }, { status: 400 })

  try {
    const run = await start(parallelReviewWorkflow, [parsed.data.proposal])
    return NextResponse.json({ runId: run.runId, statusUrl: `/api/workflows/${run.runId}` }, { status: 202 })
  } catch {
    return NextResponse.json({ error: 'The workflow runtime could not accept this run. Try again later.' }, { status: 503 })
  }
}
