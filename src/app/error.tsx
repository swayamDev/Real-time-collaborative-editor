"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { StandaloneMessage } from "@/components/standalone-message";

/** An error on a page outside the app shell (sign-in, demo, privacy). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <StandaloneMessage
      title="Something went wrong."
      message="Brahma couldn't load this page. Your saved work is not affected."
      action={{ label: "Try again", onClick: reset }}
    />
  );
}
