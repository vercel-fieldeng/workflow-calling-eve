import { WorkflowConsole } from './_components/workflow-console'

export default async function Page({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run } = await searchParams
  return <WorkflowConsole key={run ?? 'new'} initialRunId={typeof run === 'string' ? run : undefined} />
}
