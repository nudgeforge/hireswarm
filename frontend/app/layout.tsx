import type { Metadata } from "next";
import "./globals.css";
import "./spatial.css";
import "./premium.css";
import "./usability-fix.css";

export const metadata: Metadata = {
  title: "HireSwarm | Evidence-Locked Career Workspace",
  description: "Applicant-controlled, evidence-linked career preparation workspace.",
  manifest: "/manifest.json",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.ico" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
