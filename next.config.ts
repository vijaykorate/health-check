import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle the PowerShell diagnostic agent with the launcher route so it can be
  // served on Vercel (readFileSync at runtime otherwise isn't traced).
  outputFileTracingIncludes: {
    "/api/hc/launcher": ["./scripts/Pockit-PC-Diagnostic-V1.0.ps1"],
  },
};

export default nextConfig;
