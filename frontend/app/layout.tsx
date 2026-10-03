import type { Metadata, Viewport } from "next";
import "./product.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://hireswarm-production.up.railway.app"),
  title: {
    default: "HireSwarm | Evidence-backed applications",
    template: "%s | HireSwarm",
  },
  description: "An evidence-first AI team for job-specific resumes, honest fit analysis, interview preparation, and human-approved exports.",
  applicationName: "HireSwarm",
  keywords: ["job application", "resume tailoring", "CV evidence", "interview preparation", "job fit"],
  manifest: "/manifest.json",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.ico" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "HireSwarm",
    title: "HireSwarm | Evidence-backed applications",
    description: "A smarter evidence-first team for your next application — with human approval in control.",
  },
  twitter: {
    card: "summary",
    title: "HireSwarm | Evidence-backed applications",
    description: "A smarter evidence-first team for your next application — with human approval in control.",
  },
};

export const viewport: Viewport = {
  themeColor: "#F7F8FA",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
