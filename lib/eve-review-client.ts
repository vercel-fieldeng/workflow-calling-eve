import { Client } from 'eve/client'
import { getVercelOidcToken } from '@vercel/oidc'
import type { AgentName } from './review-types'

export function createReviewClient(agent: AgentName): Client {
  const deployed = Boolean(process.env.VERCEL)
  const origin = deployed
    ? `https://${process.env.VERCEL_URL}`
    : `http://127.0.0.1:${process.env.PORT || '3000'}`
  if (deployed && !process.env.VERCEL_URL) throw new Error('Deployment URL unavailable')

  return new Client({
    host: `${origin}/eve/agents/${agent}`,
    auth: deployed ? { vercelOidc: { token: () => getVercelOidcToken() } } : undefined,
    redirect: 'manual',
  })
}
