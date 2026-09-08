import { eveChannel } from "eve/channels/eve";
import { localDev, vercelOidc } from "eve/channels/auth";

// Route auth for this agent's HTTP surface. We authenticate same-project
// callers via Vercel OIDC (auto-accepted for tokens minted for our own
// VERCEL_PROJECT_ID) and fall back to `localDev()` for `next dev`. There is
// intentionally no `placeholderAuth()` here — production traffic must be an
// OIDC-authenticated call from this same deployment.
export default eveChannel({
  auth: [vercelOidc(), localDev()],
});
