import { Extension, type Extensions } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import type * as Y from "yjs";
import { CONTENT_FIELD } from "@/lib/yjs";

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

export function buildExtensions(ydoc: Y.Doc, shortcuts: EditorShortcutOptions): Extensions {
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
    EditorShortcuts.configure(shortcuts),
  ];
}
