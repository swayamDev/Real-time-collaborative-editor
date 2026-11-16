"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { StandaloneMessage } from "@/components/standalone-message";
import "./globals.css";

/** The root layout itself failed: this replaces it, so it brings its own html and styles. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en" data-theme="light">
      <body>
        <StandaloneMessage
          title="Something went wrong."
          message="Brahma couldn't load. Your saved work is not affected."
          action={{ label: "Try again", onClick: reset }}
        />
      </body>
    </html>
  );
}
