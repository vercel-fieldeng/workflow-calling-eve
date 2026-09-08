import { withEve } from "eve/next";
import { withWorkflow } from "workflow/next";

/**
 * Baseline security headers. The v0 chat preview strips framing/CSP; these
 * apply on the deployed app. Nothing here should block eve or workflow routes.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Compose: eve mounts two named agents; workflow provides the "use workflow" /
// "use step" transforms. Both wrappers return a NextConfig and can be nested.
export default withWorkflow(
  withEve(nextConfig, {
    agents: {
      benefits: "./agents/benefits",
      risks: "./agents/risks",
    },
  }),
);
