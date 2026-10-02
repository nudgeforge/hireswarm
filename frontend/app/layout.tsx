import type { Metadata } from "next";
import "./globals.css";
import "./spatial.css";
import "./premium.css";
import "./usability-fix.css";

export const metadata: Metadata = {
  title: "HireSwarm | Evidence-Locked Career Command Center",
  description: "Autonomous reverse recruiting and simulated interview engine.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
