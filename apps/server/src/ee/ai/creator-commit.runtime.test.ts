import test from 'node:test';
import assert from 'node:assert/strict';
import * as collabModule from '../../collaboration/collaboration.util';
import * as creatorCommit from './creator-commit.utils';
import { markdownToHtml, htmlToMarkdown } from '@docmost/editor-ext';

const collab = (collabModule as any).default ?? collabModule;
const applyAiCommitToDocument =
  (creatorCommit as any).applyAiCommitToDocument ??
  (creatorCommit as any).default?.applyAiCommitToDocument;

test('append commits preserve incoming paragraphs under the real markdown pipeline', async () => {
  const currentHtml = await markdownToHtml('Alpha Zeta Gamma');
  const incomingHtml = await markdownToHtml('OMEGA');

  const result = applyAiCommitToDocument({
    currentDocument: collab.htmlToJson(currentHtml),
    incomingDocument: collab.htmlToJson(incomingHtml),
    insertMode: 'append',
  });

  const resultMarkdown = htmlToMarkdown(
    collab.jsonToHtml(result.prosemirrorJson),
  );

  assert.equal(result.appliedMode, 'append');
  assert.equal(result.fallbackReason, null);
  assert.match(resultMarkdown, /Alpha Zeta Gamma/);
  assert.match(resultMarkdown, /OMEGA/);
});

test('replace commits throw a recoverable conflict when the selection snapshot is stale', async () => {
  const currentHtml = await markdownToHtml('Alpha Zeta Gamma');
  const incomingHtml = await markdownToHtml('OMEGA');

  assert.throws(
    () =>
      applyAiCommitToDocument({
        currentDocument: collab.htmlToJson(currentHtml),
        incomingDocument: collab.htmlToJson(incomingHtml),
        insertMode: 'replace',
        selectionSnapshot: {
          from: 1,
          to: 6,
          text: 'Wrong',
        },
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === 'AiCommitSelectionConflictError',
  );
});
