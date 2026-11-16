import type { Metadata } from "next";
import { StandaloneMessage } from "@/components/standalone-message";

export const metadata: Metadata = { title: "Page not found" };

/** Any address that matches no page. */
export default function NotFound() {
  return (
    <StandaloneMessage
      title="This page doesn't exist."
      message="The link may be wrong, or the page may have moved."
    />
  );
}
