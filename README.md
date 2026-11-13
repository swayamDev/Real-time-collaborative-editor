# Brahma

A collaborative document editor, built in phases. This repository is at **Phase 1**: a single-user editor that saves to Postgres, with the data model already shaped for real-time collaboration.

## What Phase 1 does

- **Documents.** Create, rename and delete documents (delete asks for confirmation). The sidebar lists them by last edit.
- **Editor.** A title field plus rich text: headings 1 to 3, bold, italic, strikethrough, inline code, code blocks, bulleted, numbered and task lists, quotes, links and horizontal rules. Markdown shortcuts work (`## `, `- `, `[ ] `, `> `, ` ``` `, `**bold**`, and so on).
- **Floating toolbar.** Appears only when text is selected. It holds a block type menu, the inline marks and a link field. `Cmd/Ctrl+K` adds a link, `Alt+F10` moves focus into the toolbar and `Esc` returns to the text.
- **Autosave.** Saves 800 ms after you stop typing, and at least every 5 seconds while you keep typing. `Cmd/Ctrl+S` saves immediately. The top bar shows `Saving`, `Saved` or `Couldn't save. Retry`. Failed saves retry with backoff.
- **Leaving safely.** If changes are not yet confirmed by the server, the browser asks before you leave. Brahma also starts a save as the page unloads (see [Data model decisions](#data-model-decisions)).
- **Theme.** A manual light/dark toggle. Light is the default, the system setting is ignored, and the choice is kept in a cookie so the first paint is correct.
- **Responsive and accessible.** Below 768 px the sidebar becomes a drawer. Everything works from the keyboard, focus is always visible, and motion respects `prefers-reduced-motion`.

Not in Phase 1: real-time sync, accounts, sharing and version history. The sections below explain where each will plug in.

## Run it locally

Requirements: Node 20.9 or newer, pnpm, and Docker (or any Postgres 14+).

```sh
pnpm install
cp .env.example .env.local      # defaults point at the local container
pnpm db:up                      # starts Postgres 17 with docker compose
pnpm db:migrate                 # creates the documents table
pnpm dev                        # http://localhost:3000
```

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm typecheck` | Generates route types, then runs `tsc` |
| `pnpm lint` | ESLint, plus a check that no file contains an em dash |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright tests. Builds and starts the app on port 3100 against `DATABASE_URL`. Run `pnpm exec playwright install chromium` once first. |
| `pnpm db:generate` | Generates a migration after a schema change |
| `pnpm db:migrate` | Applies migrations |

The end-to-end tests create documents in whatever database `DATABASE_URL` points at, so use the local container for them.

## Environment variables

See [.env.example](.env.example).

| Variable | Used by | Value |
| --- | --- | --- |
| `DATABASE_URL` | The app at runtime | Locally, the container URL. On Neon, the **pooled** connection string (its host contains `-pooler`). |
| `DATABASE_URL_UNPOOLED` | `drizzle-kit` migrations | On Neon, the **direct** connection string. Locally, the same as `DATABASE_URL`. |

Saving a document runs a short transaction that takes a row lock (`SELECT ... FOR UPDATE`). This works through Neon's pooler because PgBouncer in transaction mode keeps a whole transaction on one server connection. Schema migrations go over the direct connection.

There is no deployment yet. Phase 1 has no authentication, so it runs only locally and in CI.

## Data model decisions

```
documents
  id           uuid primary key
  title        text, default ''
  yjs_state    bytea          the encoded Yjs update for the whole document
  created_at   timestamptz
  updated_at   timestamptz    indexed, drives "sorted by last edit"
```

**Why Yjs state is stored from day one.** The document body lives in a Yjs `Y.Doc`, even though only one person edits it today. The editor (TipTap) binds to a `Y.XmlFragment` through the Collaboration extension, and Yjs owns undo and redo. The database stores the binary Yjs update, not HTML or ProseMirror JSON. This means:

- **Phase 2 (real-time sync) changes the transport, not the data.** A sync server loads the same bytes into a `Y.Doc`, and clients exchange updates that Yjs merges without conflicts. No existing document needs converting.
- **Saves are merges, not overwrites.** The client sends `Y.encodeStateAsUpdate(doc, lastAckedStateVector)`: only the changes the server has not confirmed. The server merges them into the stored state with `Y.mergeUpdates` under a row lock. Merging is commutative and idempotent, so two open tabs cannot clobber each other, and a retried save after a lost response is harmless.
- **Phase 4 (version history) has a natural unit.** Snapshots are Yjs state at a point in time, and Yjs can diff them.

Some details that are easy to get wrong:

- **Unsaved changes are tracked with update events, not state vectors.** Yjs deletions do not advance the state vector, so comparing vectors would miss a delete-only edit. Each save carries the full delete set, which is small.
- **The acknowledged state vector is captured before the editor mounts.** Otherwise the first edit would count as already saved and never be sent.
- **Saving on unload respects the keepalive limit.** Browsers cap in-flight `keepalive` request bodies at 64 KiB in total. If the pending update fits, it goes out with `keepalive`. If not, Brahma falls back to a normal `fetch`, which navigation may cancel. The before-unload warning stays up either way until the server confirms. An end-to-end test covers a document over 64 KiB.
- **No compaction yet.** `Y.mergeUpdates` does not garbage-collect, so stored state grows with edit history. In Phase 2, persistence moves to a sync server that holds a live `Y.Doc` and can store compacted snapshots.

**Why the title is a column, not part of the Yjs document.** The sidebar needs titles for every document, and renaming from the sidebar should not require loading and re-encoding Yjs state. In Phase 2 the title moves into the shared document so that it syncs live, and the server keeps copying it into this column for listing. No table change is needed.

**Ownership and workspaces.** `owner_id` and `workspace_id` arrive with authentication in Phase 3 as nullable columns. Adding a nullable column is a non-breaking migration, so the table does not carry unused columns today.

## Design system

The palette comes from natural dyes (indigo, madder, turmeric) on a cool paper, used sparingly so the writing stays the focus. Every color is a CSS variable in [src/app/globals.css](src/app/globals.css), exposed to Tailwind through `@theme`.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `paper` | `#F2F3F6` | `#12162B` | App and document canvas |
| `sunken` | `#E8EAF0` | `#0E1124` | Sidebar, code blocks |
| `raised` | `#FFFFFF` | `#1A1F38` | Menus, toolbar, dialogs |
| `ink` | `#1A1F3A` | `#E6E8F0` | Primary text |
| `ink-muted` | `#5C627A` | `#9CA2BE` | Secondary text |
| `slate` | `#6A7088` | `#7C82A0` | Icons and borders only |
| `indigo` | `#34449C` | `#9AA8F2` | Links, primary actions, focus |
| `madder` | `#B8423A` | `#E8817A` | Destructive actions and errors |
| `selection` | turmeric `#D99A1E` at 28% | at 30% | Text selection |

### Measured contrast (WCAG 2.x)

| Pair | Light | Dark |
| --- | --- | --- |
| `ink` on `paper` | 14.55 | 14.60 |
| `ink` on `raised` | n/a | 13.23 |
| `ink-muted` on `paper` | 5.43 | 7.08 |
| `ink-muted` on `sunken` | 5.01 | 7.40 |
| `indigo` on `paper` | 7.72 | 7.88 |
| `on-indigo` on `indigo` (buttons) | 8.56 | 7.88 |
| `madder` on `paper` | 4.88 | 6.68 |
| `on-madder` on `madder` (buttons) | 5.41 | 6.68 |
| `ink` on selection tint | 11.74 | 8.41 |

`slate` on paper is 4.42:1, which is why it is reserved for icons and borders (3:1 minimum) and never used for small text.

### Collaborator colors (used from Phase 2)

Each one must work as a caret on the canvas (at least 3:1) and as a name label behind text (at least 4.5:1).

| Color | Light | Caret on paper | Label text | Dark | Caret on night | Label text (night `#12162B`) |
| --- | --- | --- | --- | --- | --- | --- |
| indigo | `#34449C` | 7.72 | white 8.56 | `#8E9CF0` | 6.95 | 6.95 |
| madder | `#B8423A` | 4.88 | white 5.41 | `#E2847B` | 6.65 | 6.65 |
| turmeric | `#B87D10` | 3.17 | ink 4.60 | `#E3A83F` | 8.46 | 8.46 |
| leaf | `#4E7D4A` | 4.34 | white 4.82 | `#82B57A` | 7.52 | 7.52 |
| lac | `#A8467A` | 4.95 | white 5.49 | `#D884B0` | 6.68 | 6.68 |
| kattha | `#7A4B2E` | 6.59 | white 7.31 | `#C99470` | 6.77 | 6.77 |

Light turmeric is `#B87D10` rather than `#C98A12`, because the original measured 2.66:1 as a caret on paper.

### Type

- **UI:** Schibsted Grotesk at 12, 13, 14 and 15 px. The chrome stays quiet.
- **Document:** Literata. Body text is 19/1.65 (17 px on phones) at a 68 character measure. The title is 42 px weight 650. Headings use the optical size axis: H1 30 px, H2 24 px, H3 19 px italic.
- **Code:** Commit Mono, bundled locally under the SIL Open Font License ([license](src/fonts/commit-mono/LICENSE.txt)).

Radius follows hierarchy: none on the canvas, 4 px on inline code, 6 px on inputs and buttons, 8 px on menus and the toolbar, 10 px on dialogs. Hairline borders separate surfaces. Shadows appear only on floating layers.

## Project layout

```
src/
  app/                 routes, server actions, route handlers, global styles
  components/          app shell, sidebar, menus, dialogs
  components/editor/   TipTap editor, floating toolbar, autosave hook
  db/                  Drizzle schema and client
  lib/                 Yjs helpers, autosave controller, validation (unit tested)
  server/              database access for documents
e2e/                   Playwright tests
drizzle/               SQL migrations
```
