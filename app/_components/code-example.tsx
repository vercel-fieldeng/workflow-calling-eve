'use client'

import { useState } from 'react'
import { Check, Copy, FileCode2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CodeExample({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setError(false)
      setTimeout(() => setCopied(false), 2000)
    } catch { setError(true) }
  }
  return <section className="overflow-hidden rounded-xl border bg-card text-card-foreground"><header className="flex items-center justify-between border-b bg-muted/50 px-4 py-2"><span className="flex items-center gap-2 font-mono text-sm text-muted-foreground"><FileCode2 className="size-4" />{title}</span><Button variant="ghost" size="sm" onClick={copy}>{copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copied ? 'Copied' : 'Copy'}</Button></header><pre className="overflow-x-auto p-5 font-mono text-sm leading-7"><code>{code}</code></pre>{error && <p role="status" className="px-5 pb-4 text-sm text-muted-foreground">Copy is unavailable in this browser. Select the code to copy it.</p>}</section>
}
