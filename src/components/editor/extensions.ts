import { Extension, type Extensions } from "@tiptap/core";
import Collaboration, { isChangeOrigin } from "@tiptap/extension-collaboration";
import { LOCAL_EDIT_LIMIT_BYTES } from "@brahma/protocol";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { estimateInsertedBytes } from "@/lib/collab/edit-size";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { caretColor, caretName, onCollabVar } from "@/lib/collab/presence";
import { CONTENT_FIELD } from "@/lib/collab/yjs";

interface EditorShortcutOptions {
  /** Mod+K: open the link field in the floating toolbar. */
  onRequestLink: () => void;
  /** Alt+F10: move focus into the floating toolbar. */
  onFocusToolbar: () => void;
  /** A local change was refused because it is too large to sync as one update. */
  onTooLarge: () => void;
}

/**
 * Refuse a single local change (typically a paste) that would produce a
 * Yjs update too large to send. One update cannot be split across
 * messages, so it must be stopped before it is applied. Remote changes
 * and undo arrive through Yjs and are never refused.
 */
const EditSizeGuard = Extension.create<{ onTooLarge: () => void }>({
  name: "brahmaEditSizeGuard",
  addOptions() {
    return { onTooLarge: () => {} };
  },
  addProseMirrorPlugins() {
    const { onTooLarge } = this.options;
    return [
      new Plugin({
        key: new PluginKey("brahmaEditSizeGuard"),
        filterTransaction: (transaction) => {
          if (!transaction.docChanged || isChangeOrigin(transaction)) return true;
          if (estimateInsertedBytes(transaction) <= LOCAL_EDIT_LIMIT_BYTES) return true;
          onTooLarge();
          return false;
        },
      }),
    ];
  },
});

/** Mutable so the guard follows role changes without rebuilding the editor. */
export class ReadOnlyState {
  constructor(private value: boolean) {}

  get current(): boolean {
    return this.value;
  }

  set(value: boolean): void {
    this.value = value;
  }
}

const HISTORY_KEYS = new Set(["z", "y"]);

/**
 * Read-only for viewers, enforced inside the editor rather than only by
 * hiding controls. While read-only it refuses every local change (typing,
 * paste, drop, commands from any toolbar), swallows undo and redo (Yjs undo
 * writes to the document directly, below ProseMirror), and makes the view
 * non-editable. Changes from the server still apply.
 */
const ReadOnlyGuard = Extension.create<{ state: ReadOnlyState }>({
  name: "brahmaReadOnlyGuard",
  // Before the Collaboration extension, so undo shortcuts reach this first.
  priority: 1000,
  addOptions() {
    return { state: new ReadOnlyState(false) };
  },
  addProseMirrorPlugins() {
    const { state } = this.options;
    return [
      new Plugin({
        key: new PluginKey("brahmaReadOnlyGuard"),
        filterTransaction: (transaction) => !state.current || !transaction.docChanged || isChangeOrigin(transaction),
        props: {
          editable: () => !state.current,
          handlePaste: () => state.current,
          handleDrop: () => state.current,
          handleTextInput: () => state.current,
          handleKeyDown: (_view, event) =>
            state.current && (event.metaKey || event.ctrlKey) && HISTORY_KEYS.has(event.key.toLowerCase()),
        },
      }),
    ];
  },
});

const EditorShortcuts = Extension.create<EditorShortcutOptions>({
  name: "brahmaShortcuts",
  addOptions() {
    return { onRequestLink: () => {}, onFocusToolbar: () => {}, onTooLarge: () => {} };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        const { editor } = this;
        if (editor.state.selection.empty) {
          if (!editor.isActive("link")) return false;
          editor.chain().extendMarkRange("link").run();
        }
        this.options.onRequestLink();
        return true;
      },
      "Alt-F10": () => {
        if (this.editor.state.selection.empty) return false;
        this.options.onFocusToolbar();
        return true;
      },
    };
  },
});

/**
 * A collaborator's caret and name flag. Awareness data comes from other
 * browsers, so the name is sanitized and set as text, never as HTML, and
 * the color must be one of the six tokens.
 */
function renderCaret(user: Record<string, unknown>): HTMLElement {
  const color = caretColor(user);
  const caret = document.createElement("span");
  caret.className = "collab-caret";
  // Presence is announced by the avatar list; keep flags out of the text.
  caret.setAttribute("aria-hidden", "true");
  caret.contentEditable = "false";
  caret.style.setProperty("--caret-color", `var(--collab-${color})`);
  const label = document.createElement("span");
  label.className = "collab-caret-label";
  label.style.color = onCollabVar(color);
  label.textContent = caretName(user);
  caret.append(label);
  return caret;
}

function renderSelection(user: Record<string, unknown>) {
  return {
    nodeName: "span",
    class: "collab-selection",
    style: `background-color: color-mix(in srgb, var(--collab-${caretColor(user)}) 22%, transparent)`,
  };
}

/** The document schema: what a Brahma document can contain. */
export function contentExtensions(): Extensions {
  return [
    StarterKit.configure({
      // Yjs owns history. Its undo manager comes with the Collaboration extension.
      undoRedo: false,
      underline: false,
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null },
      },
      dropcursor: { color: "var(--indigo)", width: 2 },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
  ];
}

export function buildExtensions(
  ydoc: Y.Doc,
  shortcuts: EditorShortcutOptions,
  awareness: Awareness,
  readOnly: ReadOnlyState,
): Extensions {
  return [
    ...contentExtensions(),
    ReadOnlyGuard.configure({ state: readOnly }),
    Placeholder.configure({ placeholder: () => (readOnly.current ? "" : "Start writing") }),
    Collaboration.configure({ document: ydoc, field: CONTENT_FIELD }),
    CollaborationCaret.configure({
      // The extension only reads `provider.awareness`.
      provider: { awareness },
      // Already published by useSyncSession; passing it keeps the extension
      // from overwriting it with an empty user.
      user: awareness.getLocalState()?.user ?? {},
      render: renderCaret,
      selectionRender: renderSelection,
    }),
    EditorShortcuts.configure(shortcuts),
    EditSizeGuard.configure({ onTooLarge: shortcuts.onTooLarge }),
  ];
}
