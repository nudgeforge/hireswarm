import type { Metadata, Viewport } from "next";
import "./clean.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://hireswarm-production.up.railway.app"),
  title: "HireSwarm | One honest application at a time",
  description: "Turn real CV evidence into an honest fit check, focused preparation, and approval-gated exports. HireSwarm never applies on your behalf.",
  applicationName: "HireSwarm",
  keywords: ["job application", "CV tailoring", "resume evidence", "interview practice"],
  manifest: "/manifest.json",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.ico" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "HireSwarm",
    title: "HireSwarm | One honest application at a time",
    description: "Build one application from work you can prove — then approve every export yourself.",
  },
  twitter: {
    card: "summary",
    title: "HireSwarm | One honest application at a time",
    description: "Build one application from work you can prove — then approve every export yourself.",
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
