import type { Metadata } from "next";
import ProductWorkspace from "../components/ProductWorkspace";

export const metadata: Metadata = { title: "New application", robots: { index: false, follow: false } };

export default function NewApplicationPage() {
  return <ProductWorkspace initialView="new" />;
}
