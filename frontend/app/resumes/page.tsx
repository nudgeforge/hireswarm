import type { Metadata } from "next";
import ProductWorkspace from "../components/ProductWorkspace";

export const metadata: Metadata = { title: "Resume library", robots: { index: false, follow: false } };

export default function ResumesPage() {
  return <ProductWorkspace initialView="resumes" />;
}
