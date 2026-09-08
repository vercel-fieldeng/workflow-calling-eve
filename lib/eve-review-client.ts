import { Client } from "eve/client";
import type { AgentName } from "./review-types";

/**
 * Resolve the fixed, trusted origin for same-project eve calls.
 *
 * Precedence:
 *   1. `EVE_REVIEW_ORIGIN` — explicit override for self-hosted / non-Vercel.
 *   2. `VERCEL_URL` — set on every Vercel deployment (per-deployment hostname).
 *   3. `http://127.0.0.1:<PORT|3000>` — local `next dev`.
 *
 * We never accept a host from the HTTP request body or from user input.
 */
function resolveOrigin(): string {
  const override = process.env.EVE_REVIEW_ORIGIN?.trim();
  if (override) return override.replace(/\/+$/, "");

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  const port = process.env.PORT?.trim() || "3000";
  return `http://127.0.0.1:${port}`;
}

/**
 * Build a same-project eve client for one of our named agents.
 *
 * - Uses the deployment's `VERCEL_OIDC_TOKEN` (auto-injected on Vercel) as the
 *   bearer for `vercelOidc()` route auth. Local dev has no token; the agent's
 *   channel falls through to `localDev()`.
 * - `redirect: "manual"` prevents `fetch` from forwarding credentials to
 *   another origin if a rewrite ever returns a redirect.
 */
export function createReviewClient(agent: AgentName): Client {
  const origin = resolveOrigin();
  const host = `${origin}/eve/agents/${agent}`;

  return new Client({
    host,
    auth: {
      vercelOidc: {
        // Called before every HTTP request, including stream reconnects.
        token: async () => process.env.VERCEL_OIDC_TOKEN ?? "",
      },
    },
    redirect: "manual",
  });
}
