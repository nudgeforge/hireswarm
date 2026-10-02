import type { NextConfig } from "next";

const staticExport = process.env.STATIC_EXPORT === "true";
const backendUrl = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:;" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: staticExport ? "export" : undefined,
  allowedDevOrigins: ["*.e2b.app", "localhost"],
  // FastAPI sets the same headers in the exported Railway image. Omitting
  // Next-only route features here prevents export-mode warnings and makes the
  // build's ownership boundary explicit.
  ...(staticExport ? {} : {
    async headers() {
      return [{ source: "/:path*", headers: securityHeaders }];
    },
    async rewrites() {
      return [{ source: "/backend/:path*", destination: `${backendUrl}/:path*` }];
    },
  }),
};

export default nextConfig;
