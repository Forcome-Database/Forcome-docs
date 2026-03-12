import { JSONContent } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { jsonToNode } from '../../collaboration/collaboration.util';

export type AiCommitInsertMode =
  | 'create'
  | 'append'
  | 'overwrite'
  | 'replace';

export interface AiCommitSelectionSnapshot {
  text: string;
  from: number;
  to: number;
}

export interface ApplyAiCommitInput {
  currentDocument: JSONContent;
  incomingDocument: JSONContent;
  insertMode: AiCommitInsertMode;
  selectionSnapshot?: AiCommitSelectionSnapshot | null;
}

export interface ApplyAiCommitResult {
  prosemirrorJson: JSONContent;
  appliedMode: 'append' | 'overwrite' | 'replace';
  fallbackReason: 'stale_selection' | null;
}

export function applyAiCommitToDocument({
  currentDocument,
  incomingDocument,
  insertMode,
  selectionSnapshot,
}: ApplyAiCommitInput): ApplyAiCommitResult {
  const currentDoc = jsonToNode(currentDocument);
  const incomingDoc = jsonToNode(incomingDocument);

  if (insertMode === 'append') {
    return {
      prosemirrorJson: appendDocumentContent(currentDoc, incomingDoc),
      appliedMode: 'append',
      fallbackReason: null,
    };
  }

  if (insertMode === 'replace') {
    if (!isSelectionSnapshotValid(currentDoc, selectionSnapshot)) {
      return {
        prosemirrorJson: appendDocumentContent(currentDoc, incomingDoc),
        appliedMode: 'append',
        fallbackReason: 'stale_selection',
      };
    }

    const replacementSlice = createReplacementSlice(
      currentDoc,
      incomingDoc,
      selectionSnapshot,
    );
    const tr = new Transform(currentDoc);
    tr.replace(selectionSnapshot.from, selectionSnapshot.to, replacementSlice);
    return {
      prosemirrorJson: tr.doc.toJSON(),
      appliedMode: 'replace',
      fallbackReason: null,
    };
  }

  return {
    prosemirrorJson: incomingDoc.toJSON(),
    appliedMode: 'overwrite',
    fallbackReason: null,
  };
}

function appendDocumentContent(
  currentDoc: ReturnType<typeof jsonToNode>,
  incomingDoc: ReturnType<typeof jsonToNode>,
) {
  return {
    ...currentDoc.toJSON(),
    content: [
      ...(currentDoc.toJSON().content ?? []),
      ...(incomingDoc.toJSON().content ?? []),
    ],
  };
}

function createReplacementSlice(
  currentDoc: ReturnType<typeof jsonToNode>,
  incomingDoc: ReturnType<typeof jsonToNode>,
  selectionSnapshot: AiCommitSelectionSnapshot,
): Slice {
  const $from = currentDoc.resolve(selectionSnapshot.from);
  const $to = currentDoc.resolve(selectionSnapshot.to);
  const firstNode = incomingDoc.firstChild;

  if (
    $from.sameParent($to) &&
    $from.parent.isTextblock &&
    incomingDoc.childCount === 1 &&
    firstNode?.isTextblock
  ) {
    return new Slice(firstNode.content, 0, 0);
  }

  return new Slice(incomingDoc.content, 0, 0);
}

function isSelectionSnapshotValid(
  currentDoc: ReturnType<typeof jsonToNode>,
  selectionSnapshot?: AiCommitSelectionSnapshot | null,
): selectionSnapshot is AiCommitSelectionSnapshot {
  if (!selectionSnapshot) {
    return false;
  }

  const { from, to, text } = selectionSnapshot;
  if (from < 0 || to < from || to > currentDoc.content.size) {
    return false;
  }

  try {
    return currentDoc.textBetween(from, to) === text;
  } catch {
    return false;
  }
}
