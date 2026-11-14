// @vitest-environment jsdom
import { TITLE_FIELD } from "@brahma/protocol";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { createMirror } from "@/lib/collab/mirror";
import { CONTENT_FIELD } from "@/lib/collab/yjs";
import { documentCopy } from "./document-copy";
import { ReadOnlyState, buildExtensions } from "./extensions";

const REMOTE = Symbol("remote");

/**
 * What a malicious editor can send: raw Yjs content that never went
 * through the editor UI or its schema.
 */
function attackerUpdate(): Uint8Array {
  const doc = new Y.Doc();
  doc.getText(TITLE_FIELD).insert(0, "<script>alert('title')</script>");
  const paragraph = (text: Y.XmlText) => {
    const element = new Y.XmlElement("paragraph");
    element.insert(0, [text]);
    return element;
  };
  const formatted = (content: string, attributes: Record<string, unknown>) => {
    const text = new Y.XmlText();
    text.insert(0, content, attributes);
    return text;
  };

  const withHandler = paragraph(new Y.XmlText("plain text"));
  withHandler.setAttribute("onerror", "alert('paragraph')");
  const image = new Y.XmlElement("img");
  image.setAttribute("src", "x");
  image.setAttribute("onerror", "alert('img')");
  const heading = new Y.XmlElement("heading");
  heading.setAttribute("level", "1 onmouseover=alert('heading')" as unknown as string);
  heading.insert(0, [new Y.XmlText("Heading")]);

  doc.getXmlFragment(CONTENT_FIELD).insert(0, [
    paragraph(formatted("click me", { link: { href: "javascript:alert(document.cookie)" } })),
    paragraph(formatted("spaced", { link: { href: " java\tscript:alert(1)" } })),
    paragraph(formatted("good link", { link: { href: "https://ok.example/", onclick: "alert('attr')" } })),
    withHandler,
    image,
    paragraph(formatted("unknown mark", { evilmark: { onclick: "alert('mark')" } })),
    heading,
  ]);
  return Y.encodeStateAsUpdate(doc);
}

function victimDoc(): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, attackerUpdate(), REMOTE);
  return doc;
}

const HANDLER = /\son[a-z]+\s*=/i;

describe("Download a copy with hostile content", () => {
  it("keeps only http, https and mailto links, escapes everything, and drops unknown nodes", () => {
    const doc = victimDoc();
    const html = documentCopy(doc).html;

    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/java\s*script/i);
    expect(html).not.toMatch(HANDLER);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;alert(&#39;title&#39;)&lt;/script&gt;");
    expect(html).toContain('href="https://ok.example/"');
    expect(html).toContain("click me");
    expect(html).toContain("plain text");
    expect(html).toContain("<h1>Heading</h1>");
  });

  it("never writes to the document it exports", () => {
    const doc = victimDoc();
    const before = Y.encodeStateAsUpdate(doc);
    const writes: unknown[] = [];
    doc.on("update", (_update: Uint8Array, origin: unknown) => writes.push(origin));
    documentCopy(doc);
    expect(writes).toEqual([]);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});

describe("The editor with hostile content", () => {
  const editors: Editor[] = [];
  afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

  function open(doc: Y.Doc, readOnly = false) {
    const element = document.createElement("div");
    document.body.append(element);
    const shortcuts = { onRequestLink: () => {}, onFocusToolbar: () => {}, onTooLarge: () => {} };
    const editor = new Editor({
      element,
      extensions: buildExtensions(doc, shortcuts, new Awareness(doc), new ReadOnlyState(readOnly)),
      editable: !readOnly,
    });
    editors.push(editor);
    return { editor, element };
  }

  it("renders no script, handler or unsafe link", () => {
    const { element } = open(victimDoc());
    const html = element.innerHTML;
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(HANDLER);
    expect(element.querySelector("img, script")).toBeNull();
    for (const link of element.querySelectorAll("a")) {
      const href = link.getAttribute("href") ?? "";
      expect(href === "" || /^(https?|mailto):/.test(href)).toBe(true);
    }
    expect(element.textContent).toContain("plain text");
  });

  it("never writes to a viewer's document: the viewer's editor works on a mirror", () => {
    const doc = victimDoc();
    const before = Y.encodeStateAsUpdate(doc);
    const writes: unknown[] = [];
    doc.on("update", (_update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) writes.push(origin);
    });
    const mirror = createMirror(doc);
    const stop = mirror.follow();
    const { element } = open(mirror.doc, true);
    expect(element.textContent).toContain("plain text");
    expect(writes).toEqual([]);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);

    // It still follows the real document.
    const later = new Y.XmlElement("paragraph");
    later.insert(0, [new Y.XmlText("from the server")]);
    doc.getXmlFragment(CONTENT_FIELD).push([later]);
    expect(element.textContent).toContain("from the server");
    stop();
  });

  it("for editors, removes only what does not fit the schema, so every client converges", () => {
    const doc = victimDoc();
    open(doc);
    const shared = doc.getXmlFragment(CONTENT_FIELD).toString();
    expect(shared).not.toContain("<img");
    expect(shared).not.toContain("evilmark");
    for (const kept of ["click me", "plain text", "good link", "Heading"]) expect(shared).toContain(kept);
  });

  it("keeps working when an unknown node arrives while it is open", () => {
    const doc = new Y.Doc();
    const { editor, element } = open(doc);
    editor.commands.insertContent("mine");

    // A collaborator inserts a node type this schema does not know, then valid text.
    const attacker = new Y.Doc();
    Y.applyUpdate(attacker, Y.encodeStateAsUpdate(doc));
    const unknown = new Y.XmlElement("marquee");
    unknown.insert(0, [new Y.XmlText("unknown")]);
    attacker.getXmlFragment(CONTENT_FIELD).insert(0, [unknown]);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(attacker, Y.encodeStateVector(doc)), REMOTE);

    const later = new Y.XmlElement("paragraph");
    later.insert(0, [new Y.XmlText("later")]);
    attacker.getXmlFragment(CONTENT_FIELD).push([later]);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(attacker, Y.encodeStateVector(doc)), REMOTE);

    expect(editor.isDestroyed).toBe(false);
    expect(element.textContent).toContain("mine");
    expect(element.textContent).toContain("later");
    expect(element.querySelector("marquee")).toBeNull();
    editor.commands.insertContent(" still editable");
    expect(element.textContent).toContain("still editable");
  });
});
