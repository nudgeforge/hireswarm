import type { Metadata } from "next";
import ProductWorkspace from "../components/ProductWorkspace";

export const metadata: Metadata = { title: "Agent control room", robots: { index: false, follow: false } };

export default function PracticePage() {
  return <ProductWorkspace initialView="agents" />;
}
