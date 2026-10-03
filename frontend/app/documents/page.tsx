import type { Metadata } from "next";
import ProductWorkspace from "../components/ProductWorkspace";

export const metadata: Metadata = { title: "Documents", robots: { index: false, follow: false } };

export default function DocumentsPage() {
  return <ProductWorkspace initialView="documents" />;
}
