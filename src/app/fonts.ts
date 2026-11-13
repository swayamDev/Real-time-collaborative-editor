import { Literata, Schibsted_Grotesk } from "next/font/google";
import localFont from "next/font/local";

export const uiFont = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--nf-ui",
  display: "swap",
});

// Literata ships an optical size axis. Large headings use the display cut,
// body text uses the text cut. See `font-variation-settings` in globals.css.
export const documentFont = Literata({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--nf-document",
  display: "swap",
});

// Commit Mono is not on Google Fonts. The files are bundled under the SIL OFL,
// see src/fonts/commit-mono/LICENSE.txt.
export const codeFont = localFont({
  src: [
    { path: "../fonts/commit-mono/CommitMono-400-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/commit-mono/CommitMono-400-Italic.woff2", weight: "400", style: "italic" },
    { path: "../fonts/commit-mono/CommitMono-700-Regular.woff2", weight: "700", style: "normal" },
  ],
  variable: "--nf-code",
  display: "swap",
});
