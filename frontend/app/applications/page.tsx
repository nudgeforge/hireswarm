import type { Metadata } from "next";
import ProductWorkspace from "../components/ProductWorkspace";

export const metadata: Metadata = { title: "My applications", robots: { index: false, follow: false } };

export default function ApplicationsPage() {
  return <ProductWorkspace initialView="applications" />;
}
