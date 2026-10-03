import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./spatial.css";
import "./premium.css";
import "./usability-fix.css";
import "./craft.css";
import "./guided.css";
import "./contrast.css";
import "./focus.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://hireswarm-production.up.railway.app"),
  title: "HireSwarm | The evidence-backed application studio",
  description: "Turn real CV evidence into a focused application plan, honest interview practice, and approval-gated exports. HireSwarm never applies on your behalf.",
  applicationName: "HireSwarm",
  keywords: ["job application", "CV tailoring", "resume evidence", "interview practice", "application tracker"],
  manifest: "/manifest.json",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.ico" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "HireSwarm",
    title: "HireSwarm | The evidence-backed application studio",
    description: "Build an application from work you can actually prove — then approve every export yourself.",
  },
  twitter: {
    card: "summary",
    title: "HireSwarm | The evidence-backed application studio",
    description: "Build an application from work you can actually prove — then approve every export yourself.",
  },
};

export const viewport: Viewport = {
  themeColor: "#102b24",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
