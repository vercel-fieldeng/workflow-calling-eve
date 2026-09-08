'use client'

import { ArrowUpRight, Check, Circle, Clock3, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

export type AgentView = {
  status: string
  sessionId?: string | null
  output?: unknown
  error?: string | null
  durationMs?: number | null
}

const labels: Record<string, string> = { idle: 'Ready', queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', waiting: 'Waiting', pending: 'Queued' }

function Output({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return <p className="whitespace-pre-wrap text-pretty leading-relaxed">{value}</p>
  if (Array.isArray(value)) return <ul className="flex list-disc flex-col gap-3 pl-4 marker:text-muted-foreground">{value.map((item, i) => <li key={i}><Output value={item} /></li>)}</ul>
  if (typeof value === 'object') return <div className="flex flex-col gap-5">{Object.entries(value).map(([key, item]) => <section key={key} className="flex flex-col gap-2"><h3 className="text-sm font-medium capitalize">{key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')}</h3><div className="text-muted-foreground"><Output value={item} /></div></section>)}</div>
  return <span>{String(value)}</span>
}

export function AgentResult({ kind, agent }: { kind: 'benefits' | 'risks'; agent?: AgentView }) {
  const status = agent?.status ?? 'idle'
  const busy = ['running', 'waiting'].includes(status)
  const Icon = kind === 'benefits' ? ArrowUpRight : ShieldCheck
  const StatusIcon = status === 'completed' ? Check : status === 'failed' ? TriangleAlert : busy ? Loader2 : Circle
  return (
    <Card className="min-w-0 flex-1">
      <CardHeader>
        <div className="mb-3 flex size-9 items-center justify-center rounded-lg border bg-background text-foreground"><Icon className="size-5" /></div>
        <CardTitle><h2>{kind === 'benefits' ? 'Benefits analyst' : 'Risk analyst'}</h2></CardTitle>
        <CardDescription>{kind === 'benefits' ? 'The opportunity. What could go right.' : 'The trade-offs. What to watch for.'}</CardDescription>
        <CardAction><Badge variant={status === 'completed' ? 'default' : 'outline'}><StatusIcon data-icon="inline-start" className={busy ? 'animate-spin' : ''} />{labels[status] ?? status}</Badge></CardAction>
      </CardHeader>
      <CardContent className="flex-1">
        {agent?.error ? <div role="alert" className="flex flex-col gap-2 py-4"><p className="font-medium">This branch could not finish.</p><p className="text-sm leading-relaxed text-muted-foreground">{agent.error}</p></div> : agent?.output ? <div className="pb-3"><Output value={agent.output} /></div> : <Empty className="min-h-40 px-0 py-5"><EmptyHeader><EmptyMedia><Icon className="size-6 text-muted-foreground/50" /></EmptyMedia><EmptyTitle>{busy ? 'Analyzing your proposal' : status === 'queued' ? 'Waiting to start' : 'A second perspective, on demand'}</EmptyTitle><EmptyDescription>{busy ? 'This agent is working in its own eve session.' : 'Run the workflow to see the analysis here.'}</EmptyDescription></EmptyHeader></Empty>}
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-sm text-muted-foreground" title={agent?.sessionId ?? undefined}>{agent?.sessionId ?? `eve / ${kind}`}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground"><Clock3 className="size-3.5" />{agent?.durationMs != null ? `${(agent.durationMs / 1000).toFixed(1)}s` : 'Not started'}</span>
      </CardFooter>
    </Card>
  )
}
