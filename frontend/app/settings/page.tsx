import type { Metadata } from "next";
import ProductWorkspace from "../components/ProductWorkspace";

export const metadata: Metadata = { title: "Workspace settings", robots: { index: false, follow: false } };

export default function SettingsPage() {
  return <ProductWorkspace initialView="settings" />;
}
