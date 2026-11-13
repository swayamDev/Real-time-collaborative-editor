"use client";

import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  CornerDownLeft,
  Italic,
  Link2,
  Strikethrough,
  Unlink,
} from "lucide-react";
import { forwardRef, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { iconProps } from "../icon-button";
import { Menu } from "../menu";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "Cmd" : "Ctrl";

type BlockType = "paragraph" | "h1" | "h2" | "h3" | "bulletList" | "orderedList" | "taskList" | "blockquote" | "codeBlock";

const BLOCK_LABELS: Record<BlockType, string> = {
  paragraph: "Text",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  bulletList: "Bulleted list",
  orderedList: "Numbered list",
  taskList: "Task list",
  blockquote: "Quote",
  codeBlock: "Code block",
};

function currentBlock(editor: Editor): BlockType {
  if (editor.isActive("codeBlock")) return "codeBlock";
  if (editor.isActive("taskList")) return "taskList";
  if (editor.isActive("bulletList")) return "bulletList";
  if (editor.isActive("orderedList")) return "orderedList";
  if (editor.isActive("blockquote")) return "blockquote";
  for (const level of [1, 2, 3] as const) {
    if (editor.isActive("heading", { level })) return `h${level}`;
  }
  return "paragraph";
}

/**
 * Return focus to the editor without TipTap's focus command, which restores
 * the selection a frame later and can undo keys pressed in between.
 */
function refocus(editor: Editor): void {
  if (!editor.view.hasFocus()) editor.view.focus();
}

function setBlock(editor: Editor, block: BlockType): void {
  const chain = editor.chain().clearNodes();
  switch (block) {
    case "paragraph":
      chain.setParagraph().run();
      break;
    case "h1":
    case "h2":
    case "h3":
      chain.setHeading({ level: Number(block[1]) as 1 | 2 | 3 }).run();
      break;
    case "bulletList":
      chain.toggleBulletList().run();
      break;
    case "orderedList":
      chain.toggleOrderedList().run();
      break;
    case "taskList":
      chain.toggleTaskList().run();
      break;
    case "blockquote":
      chain.toggleBlockquote().run();
      break;
    case "codeBlock":
      chain.toggleCodeBlock().run();
      break;
  }
  refocus(editor);
}

/** Adds https:// to bare domains like "example.com"; leaves other schemes alone. */
export function normalizeHref(raw: string): string {
  const href = raw.trim();
  if (href === "") return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/") || href.startsWith("#")) return href;
  return `https://${href}`;
}

const ToolbarButton = forwardRef<
  HTMLButtonElement,
  { label: string; shortcut?: string; active?: boolean; onClick: () => void; children: React.ReactNode }
>(function ToolbarButton({ label, shortcut, active, onClick, children }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      // Keep the text selection while clicking.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-sm transition-colors duration-100",
        active ? "bg-indigo-tint text-indigo" : "text-ink-muted hover:bg-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  );
});

interface BubbleToolbarProps {
  editor: Editor;
  linkMode: boolean;
  setLinkMode: (on: boolean) => void;
}

export function BubbleToolbar({ editor, linkMode, setLinkMode }: BubbleToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
      block: currentBlock(e),
    }),
  });

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8, flip: true, shift: { padding: 8 } }}
      shouldShow={({ editor: e, element, view, state: editorState, from, to }) => {
        const focusInside = element.contains(document.activeElement);
        if (!view.hasFocus() && !focusInside) return false;
        if (!e.isEditable || from === to) return false;
        if (editorState.selection instanceof NodeSelection) return false;
        if (e.isActive("codeBlock")) return false;
        return true;
      }}
      className="z-40"
    >
      <div
        role="toolbar"
        aria-label="Formatting"
        data-testid="bubble-toolbar"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setLinkMode(false);
            refocus(editor);
          }
          if (!linkMode && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (index === -1) return;
            event.preventDefault();
            const next = event.key === "ArrowRight" ? index + 1 : index - 1;
            buttons[(next + buttons.length) % buttons.length]?.focus();
          }
        }}
        className="animate-menu-in flex items-center gap-0.5 rounded-md border border-hairline bg-raised p-1 font-ui text-ui-sm text-ink shadow-float"
      >
        {linkMode ? (
          <LinkField
            initialHref={state.href}
            hasLink={state.link}
            onApply={(href) => {
              const chain = editor.chain().extendMarkRange("link");
              if (href === "") chain.unsetLink().run();
              else chain.setLink({ href }).run();
              setLinkMode(false);
              refocus(editor);
            }}
            onRemove={() => {
              editor.chain().extendMarkRange("link").unsetLink().run();
              setLinkMode(false);
              refocus(editor);
            }}
          />
        ) : (
          <>
            <Menu
              align="start"
              items={(Object.keys(BLOCK_LABELS) as BlockType[]).map((block) => ({
                label: BLOCK_LABELS[block],
                checked: state.block === block,
                icon: (
                  <Check {...iconProps} className={state.block === block ? "text-indigo" : "invisible"} />
                ),
                onSelect: () => setBlock(editor, block),
              }))}
              trigger={(props) => (
                <button
                  {...props}
                  type="button"
                  aria-label={`Block type: ${BLOCK_LABELS[state.block]}`}
                  className="inline-flex h-8 items-center gap-1 rounded-sm pr-1.5 pl-2 font-medium text-ink transition-colors duration-100 hover:bg-hover"
                >
                  {BLOCK_LABELS[state.block]}
                  <ChevronDown {...iconProps} size={14} className="text-ink-muted" />
                </button>
              )}
            />
            <span aria-hidden className="mx-0.5 h-5 w-px bg-hairline-strong" />
            <ToolbarButton
              label="Bold"
              shortcut={`${mod}+B`}
              active={state.bold}
              onClick={() => {
                editor.chain().toggleBold().run();
                refocus(editor);
              }}
            >
              <Bold {...iconProps} />
            </ToolbarButton>
            <ToolbarButton
              label="Italic"
              shortcut={`${mod}+I`}
              active={state.italic}
              onClick={() => {
                editor.chain().toggleItalic().run();
                refocus(editor);
              }}
            >
              <Italic {...iconProps} />
            </ToolbarButton>
            <ToolbarButton
              label="Strikethrough"
              shortcut={`${mod}+Shift+S`}
              active={state.strike}
              onClick={() => {
                editor.chain().toggleStrike().run();
                refocus(editor);
              }}
            >
              <Strikethrough {...iconProps} />
            </ToolbarButton>
            <ToolbarButton
              label="Inline code"
              shortcut={`${mod}+E`}
              active={state.code}
              onClick={() => {
                editor.chain().toggleCode().run();
                refocus(editor);
              }}
            >
              <Code {...iconProps} />
            </ToolbarButton>
            <ToolbarButton
              label="Link"
              shortcut={`${mod}+K`}
              active={state.link}
              onClick={() => setLinkMode(true)}
            >
              <Link2 {...iconProps} />
            </ToolbarButton>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}

function LinkField({
  initialHref,
  hasLink,
  onApply,
  onRemove,
}: {
  initialHref: string;
  hasLink: boolean;
  onApply: (href: string) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // The bubble menu may still be hidden while it positions itself, and a
  // hidden input cannot take focus (it re-measures after a 250ms delay).
  // Retry for up to about 40 frames until focus lands.
  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    const tryFocus = () => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      if (document.activeElement === input) {
        input.select();
      } else if (attempts++ < 40) {
        frame = requestAnimationFrame(tryFocus);
      }
    };
    tryFocus();
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <form
      className="flex items-center gap-0.5"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(normalizeHref(inputRef.current?.value ?? ""));
      }}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="url"
        aria-label="Link address"
        placeholder="Paste or type a link"
        defaultValue={initialHref}
        className="focus-inset h-8 w-64 max-w-[60vw] rounded-sm bg-transparent px-2 text-ui-sm text-ink outline-none placeholder:text-ink-muted"
      />
      <ToolbarButton label="Apply link" shortcut="Enter" onClick={() => onApply(normalizeHref(inputRef.current?.value ?? ""))}>
        <CornerDownLeft {...iconProps} />
      </ToolbarButton>
      {hasLink && (
        <ToolbarButton label="Remove link" onClick={onRemove}>
          <Unlink {...iconProps} />
        </ToolbarButton>
      )}
    </form>
  );
}
