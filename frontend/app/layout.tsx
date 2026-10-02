import type { Metadata } from "next";
import "./globals.css";
import "./spatial.css";
import "./premium.css";
import "./usability-fix.css";

export const metadata: Metadata = {
  title: "HireSwarm | Stronger applications from real experience",
  description: "Evidence-backed job application preparation, with your approval before export.",
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
