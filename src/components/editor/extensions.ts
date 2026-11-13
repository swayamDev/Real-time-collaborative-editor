import { Extension, type Extensions } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
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
}

const EditorShortcuts = Extension.create<EditorShortcutOptions>({
  name: "brahmaShortcuts",
  addOptions() {
    return { onRequestLink: () => {}, onFocusToolbar: () => {} };
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

export function buildExtensions(
  ydoc: Y.Doc,
  shortcuts: EditorShortcutOptions,
  awareness: Awareness,
): Extensions {
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
    Placeholder.configure({ placeholder: "Start writing" }),
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
  ];
}
