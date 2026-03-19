import { markdownToHtml } from "@docmost/editor-ext";
import { NodeSelection } from "@tiptap/pm/state";
import type { SelectionSnapshot } from "./ai-creator.types";
import {
  extractTitle,
  isSelectionStillValid,
  preprocessImagesForEditor,
} from "./ai-creator-utils";
import { shouldResetEditorBeforeStreaming } from "./ai-creator-session";

function renderMarkdownToEditorHtml(content: string): string {
  return markdownToHtml(content) as string;
}

const DEFAULT_EDITOR_INSERT_CHUNK_SIZE = 1600;

export function maybeExtractTitle(
  titleEditor: any,
  markdown: string,
): string {
  if (!titleEditor) {
    return markdown;
  }

  const currentTitle = titleEditor.state.doc.textContent.trim();
  if (currentTitle) {
    return markdown;
  }

  const [title, remaining] = extractTitle(markdown);
  if (title) {
    titleEditor.commands.setContent(title);
    return remaining;
  }

  return markdown;
}

export function prepareEditorForStreamingWrite(
  editor: any,
  insertMode: string,
  selectionSnapshot: SelectionSnapshot | null,
): void {
  if (!editor || !shouldResetEditorBeforeStreaming(insertMode, selectionSnapshot)) {
    return;
  }

  editor.chain().focus().clearContent().run();
}

export function appendMarkdownToEditor(editor: any, markdown: string): void {
  const html = renderMarkdownToEditorHtml(preprocessImagesForEditor(markdown));
  if (html) {
    editor.chain().focus("end").insertContent(html).run();
  }
}

export function splitMarkdownForEditorInsert(
  markdown: string,
  maxChunkLength: number = DEFAULT_EDITOR_INSERT_CHUNK_SIZE,
): string[] {
  if (!markdown.trim()) {
    return [];
  }

  const paragraphs = markdown
    .split("\n\n")
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    const candidate = currentChunk
      ? `${currentChunk}\n\n${paragraph}`
      : paragraph;

    if (currentChunk && candidate.length > maxChunkLength) {
      chunks.push(currentChunk);
      currentChunk = paragraph;
      continue;
    }

    currentChunk = candidate;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export function insertMarkdownAtDocumentEnd(
  editor: any,
  markdown: string,
  maxChunkLength: number = DEFAULT_EDITOR_INSERT_CHUNK_SIZE,
): boolean {
  if (!editor) {
    return false;
  }

  const chunks = splitMarkdownForEditorInsert(markdown, maxChunkLength);
  let inserted = false;

  for (const chunk of chunks) {
    const html = renderMarkdownToEditorHtml(preprocessImagesForEditor(chunk));
    if (!html) {
      continue;
    }

    inserted = true;
    const didInsert = editor.chain().focus("end").insertContent(html).run();
    if (!didInsert) {
      return false;
    }
  }

  return inserted;
}

export function flushMarkdownParagraphsToEditor(
  buffer: string,
  editor: any,
  flush: boolean = false,
): string {
  const paragraphs = buffer.split("\n\n");
  if (!flush && paragraphs.length <= 1) {
    return buffer;
  }

  const toInsert = flush ? buffer : paragraphs.slice(0, -1).join("\n\n");
  const remaining = flush ? "" : paragraphs[paragraphs.length - 1];

  if (toInsert.trim()) {
    appendMarkdownToEditor(editor, toInsert);
  }

  return remaining;
}

export function applyMarkdownSelectionWrite(
  editor: any,
  markdown: string,
  selectionSnapshot: SelectionSnapshot,
): boolean {
  if (!isSelectionStillValid(editor, selectionSnapshot)) {
    return false;
  }

  const $from = editor.state.doc.resolve(selectionSnapshot.from);
  const isInCodeBlock = $from.parent.type.name === "codeBlock";
  const isCodeBlockNodeSelected =
    editor.state.selection instanceof NodeSelection &&
    editor.state.selection.node.type.name === "codeBlock";

  if (isInCodeBlock || isCodeBlockNodeSelected) {
    const codeMatch = markdown.match(/```[\w]*\n([\s\S]*?)```/);
    const plainCode = codeMatch ? codeMatch[1].replace(/\n$/, "") : markdown;

    if (isCodeBlockNodeSelected) {
      const oldNode = editor.state.selection.node;
      const language = oldNode.attrs.language || "mermaid";
      const newNode = editor.state.schema.nodes.codeBlock.create(
        { language },
        plainCode ? editor.state.schema.text(plainCode) : undefined,
      );
      const { tr } = editor.state;
      tr.replaceWith(selectionSnapshot.from, selectionSnapshot.to, newNode);
      editor.view.dispatch(tr);
      return true;
    }

    const { tr } = editor.state;
    tr.insertText(plainCode, selectionSnapshot.from, selectionSnapshot.to);
    editor.view.dispatch(tr);
    return true;
  }

  const html = renderMarkdownToEditorHtml(preprocessImagesForEditor(markdown));
  if (!html) {
    return false;
  }

  editor
    .chain()
    .focus()
    .setTextSelection(selectionSnapshot)
    .insertContent(html)
    .run();
  return true;
}
