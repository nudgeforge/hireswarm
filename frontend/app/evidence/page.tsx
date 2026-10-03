import type { Metadata } from "next";
import ProductWorkspace from "../components/ProductWorkspace";

export const metadata: Metadata = { title: "Evidence library", robots: { index: false, follow: false } };

export default function EvidencePage() {
  return <ProductWorkspace initialView="evidence" />;
}
