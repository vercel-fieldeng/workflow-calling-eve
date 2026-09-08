'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { ArrowUpRight, Code2, GitFork, Layers2, Loader2, Play, RotateCcw, Terminal, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { AgentResult } from './agent-result'
import { PROPOSAL_MIN, PROPOSAL_MAX, type ReviewStatus } from '@/lib/review-types'
import { CodeExample } from './code-example'

const sample = 'We want to switch our 20-person product team to a four-day workweek. We would keep salaries the same, reduce recurring meetings, and run a three-month pilot before deciding whether to make it permanent.'
const terminal = ['completed', 'partial_failure', 'failed', 'cancelled']
async function fetchStatus(url: string): Promise<ReviewStatus> {
  const response = await fetch(url)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Unable to load this workflow run.')
  return data
}

export function WorkflowConsole({ initialRunId }: { initialRunId?: string }) {
  const router = useRouter()
  const [proposal, setProposal] = useState(sample)
  const [runId, setRunId] = useState(initialRunId)
  const [submitting, setSubmitting] = useState(false)
  const submitLock = useRef(false)
  const [submitError, setSubmitError] = useState<string>()
  const [activeTab, setActiveTab] = useState('playground')
  const { data: run, error, isLoading, mutate } = useSWR(runId ? `/api/workflows/${encodeURIComponent(runId)}` : null, fetchStatus, {
    refreshInterval: data => data && terminal.includes(data.overall) ? 0 : 2000,
    shouldRetryOnError: false,
    revalidateOnFocus: true,
  })
  const busy = submitting || Boolean(runId && (!run || !terminal.includes(run.overall)) && !error)
  const currentStatus = submitting ? 'Starting workflow' : error ? 'Connection error' : run ? run.overall.replaceAll('_', ' ') : 'Ready to run'

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitLock.current || busy || !proposal.trim()) return
    submitLock.current = true
    setSubmitting(true)
    setSubmitError(undefined)
    try {
      const response = await fetch('/api/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proposal: proposal.trim() }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'The workflow could not start.')
      setRunId(data.runId)
      router.replace(`/?run=${encodeURIComponent(data.runId)}`, { scroll: false })
    } catch (cause) { setSubmitError(cause instanceof Error ? cause.message : 'The workflow could not start.') }
    finally { submitLock.current = false; setSubmitting(false) }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-app.vercel.app'
  const postExample = `curl -X POST '${origin}/api/workflows' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify({ proposal: 'Should our team try a four-day workweek?' })}'`
  const getExample = `curl '${origin}/api/workflows/${runId ?? 'YOUR_RUN_ID'}'`

  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card text-card-foreground">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <a href="/" className="flex items-center gap-3" aria-label="eve workflows home"><span className="text-2xl font-semibold tracking-tighter">eve<span className="text-primary">.</span></span><span className="h-5 border-l" /><span className="text-sm text-muted-foreground">workflow examples</span></a>
          <a href="https://github.com/vercel/eve" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">Documentation<ArrowUpRight className="size-4" /></a>
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-7 px-5 py-9 sm:px-8 sm:py-10">
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Workflow className="size-4" /><span>Orchestration</span><span className="text-muted-foreground/50">/</span><span className="text-foreground">Parallel agents</span></div>
          <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">One proposal. Two perspectives.</h1><Badge variant="outline"><GitFork data-icon="inline-start" />Fan-out / fan-in</Badge></div>
          <p className="max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground">Two independent eve agents, called programmatically by a durable workflow. Explore the upside and the risks at the same time.</p>
        </section>
        <Tabs value={activeTab} onValueChange={value => setActiveTab(String(value))} className="gap-6">
          <div className="flex items-center justify-between border-b pb-1"><TabsList variant="line"><TabsTrigger value="playground"><Layers2 data-icon="inline-start" />Playground</TabsTrigger><TabsTrigger value="code"><Code2 data-icon="inline-start" />Code & API</TabsTrigger></TabsList><span className="hidden font-mono text-sm text-muted-foreground sm:block">eve × workflow</span></div>
          <TabsContent value="playground" className="flex flex-col gap-6">
            <section className="overflow-hidden rounded-xl border bg-card text-card-foreground">
              <form onSubmit={submit} className="flex flex-col">
                <div className="p-5"><FieldGroup><Field data-disabled={busy}><div className="flex items-center justify-between"><FieldLabel htmlFor="proposal">Your proposal</FieldLabel><Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => setProposal(sample)}><RotateCcw data-icon="inline-start" />Use example</Button></div><Textarea id="proposal" value={proposal} onChange={event => setProposal(event.target.value)} minLength={PROPOSAL_MIN} maxLength={PROPOSAL_MAX} required disabled={busy} className="min-h-28 resize-y" placeholder="Describe a decision, idea, or proposal to evaluate…" /><FieldDescription>Both agents receive this exact input. No external research or shared conversation.</FieldDescription></Field></FieldGroup></div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/40 px-5 py-3"><span className="flex items-center gap-2 text-sm text-muted-foreground"><GitFork className="size-4" />2 agents<span className="text-muted-foreground/40">·</span>Parallel execution</span><Button type="submit" disabled={busy || proposal.trim().length < PROPOSAL_MIN}>{busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Play data-icon="inline-start" />}{busy ? 'Running workflow' : 'Run workflow'}</Button></div>
              </form>
            </section>
            {(submitError || error) && <Alert variant="destructive"><AlertTitle>{submitError ? 'Unable to start workflow' : 'Unable to load run'}</AlertTitle><AlertDescription>{submitError || error.message}{error && <Button variant="outline" size="sm" onClick={() => mutate()}>Reconnect to run</Button>}</AlertDescription></Alert>}
            <section className="flex flex-col gap-4" aria-label="Workflow execution">
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><h2 className="text-sm font-medium">Agent outputs</h2><span className="text-sm capitalize text-muted-foreground" role="status">{isLoading ? 'Connecting to run' : currentStatus}</span></div><span className="max-w-full truncate font-mono text-sm text-muted-foreground" title={runId}>{runId ?? 'No run started'}</span></div>
              {run?.proposal && run.proposal !== proposal && <p className="rounded-lg border p-3 text-sm leading-relaxed text-muted-foreground">Saved input: {run.proposal}</p>}
              {run?.workflowError && <Alert><AlertTitle>Workflow stopped</AlertTitle><AlertDescription>{run.workflowError}</AlertDescription></Alert>}
              <div className="flex flex-col items-stretch gap-4 sm:flex-row"><AgentResult kind="benefits" agent={run?.branches?.benefits} /><AgentResult kind="risks" agent={run?.branches?.risks} /></div>
              {run && terminal.includes(run.overall) && <p role="status" className="text-sm text-muted-foreground">{run.overall === 'completed' ? 'Both agents finished. Their independent results are saved with this run.' : run.overall === 'partial_failure' ? 'One agent failed. The other result is preserved.' : 'The workflow could not complete. See the branch errors above.'}</p>}
            </section>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"><p>A workflow controls the execution, not another agent.</p><Button variant="ghost" size="sm" onClick={() => setActiveTab('code')}>See how it works<ArrowUpRight data-icon="inline-end" /></Button></div>
          </TabsContent>
          <TabsContent value="code" className="flex flex-col gap-6">
            <div className="flex flex-col gap-2"><h2 className="text-xl font-semibold tracking-tight">Call agents from your code.</h2><p className="text-sm leading-relaxed text-muted-foreground">The API starts the outer workflow and returns a run ID. Each branch creates its own eve session; the workflow joins both outcomes.</p></div>
            <CodeExample title="workflows/parallel-review.ts · fan-out" code={'export async function parallelReviewWorkflow(proposal) {\n  "use workflow";\n\n  const results = await Promise.allSettled([\n    runBranch("benefits", proposal),\n    runBranch("risks", proposal),\n  ]);\n\n  // Each branch admits an eve session, then polls\n  // that session in durable steps until it settles.\n  return results;\n}'} />
            <CodeExample title="eve/client · session admission" code={'import { Client } from "eve/client";\n\n// Within the admission step, with a trusted agent URL.\nconst client = createReviewClient(agent);\nconst { session } = await client.sessions.create({\n  message: proposal,\n  outputSchema: analysisSchema,\n});\n\nreturn { sessionId: session.state.sessionId };'} />
            <p className="text-sm text-muted-foreground">Excerpts show the calling pattern. The implementation also validates inputs, bounds polling, and preserves errors per branch.</p>
            <CodeExample title="Start a workflow" code={postExample} />
            <CodeExample title="Inspect progress and results" code={getExample} />
            <div className="rounded-xl border bg-card p-5 text-card-foreground"><h3 className="flex items-center gap-2 font-medium"><Terminal className="size-4" />Inside the workflow</h3><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Each agent runs independently. Session admission and result collection are separate durable steps, so collecting a result never starts a new agent. A failed branch does not discard the other result. The URL keeps your run ID so you can refresh and reconnect.</p></div>
          </TabsContent>
        </Tabs>
        <footer className="flex flex-col gap-2 border-t pt-5 text-sm text-muted-foreground"><p>Demo environment. Each run makes real model calls and uses AI Gateway credits.</p><p>Public API with no user accounts. Add authentication before sharing beyond a trusted audience.</p></footer>
      </main>
    </div>
  )
}
