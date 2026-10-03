import type { Metadata } from "next";
import ProductWorkspace from "../components/ProductWorkspace";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false, follow: false } };

export default function WorkspacePage() {
  return <ProductWorkspace initialView="overview" />;
}
