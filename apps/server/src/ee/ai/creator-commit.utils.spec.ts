import { Node, Schema } from '@tiptap/pm/model';

jest.mock('../../collaboration/collaboration.util', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: {
        content: 'text*',
        group: 'block',
        toDOM() {
          return ['p', 0];
        },
      },
      text: { group: 'inline' },
    },
  });

  return {
    jsonToNode: (json: any) => Node.fromJSON(schema, json),
  };
});

import { applyAiCommitToDocument } from './creator-commit.utils';

describe('creator-commit utils', () => {
  const createDoc = (content: any[]) => ({
    type: 'doc',
    content,
  });

  it('overwrites the whole document for create/overwrite commits', () => {
    const result = applyAiCommitToDocument({
      currentDocument: createDoc([
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
      ]),
      incomingDocument: createDoc([
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ]),
      insertMode: 'overwrite',
    });

    expect(result).toEqual({
      prosemirrorJson: createDoc([
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ]),
      appliedMode: 'overwrite',
      fallbackReason: null,
    });
  });

  it('appends generated content for append commits', () => {
    const result = applyAiCommitToDocument({
      currentDocument: createDoc([
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
      ]),
      incomingDocument: createDoc([
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ]),
      insertMode: 'append',
    });

    expect(result.prosemirrorJson).toEqual(
      createDoc([
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ]),
    );
    expect(result.appliedMode).toBe('append');
    expect(result.fallbackReason).toBeNull();
  });

  it('replaces the validated selection for replace commits', () => {
    const result = applyAiCommitToDocument({
      currentDocument: createDoc([
        { type: 'paragraph', content: [{ type: 'text', text: 'before text' }] },
      ]),
      incomingDocument: createDoc([
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ]),
      insertMode: 'replace',
      selectionSnapshot: {
        from: 1,
        to: 7,
        text: 'before',
      },
    });

    expect(result.prosemirrorJson).toEqual(
      createDoc([
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'after text' }],
        },
      ]),
    );
    expect(result.appliedMode).toBe('replace');
    expect(result.fallbackReason).toBeNull();
  });

  it('falls back to append when the selection snapshot is stale', () => {
    const result = applyAiCommitToDocument({
      currentDocument: createDoc([
        { type: 'paragraph', content: [{ type: 'text', text: 'before text' }] },
      ]),
      incomingDocument: createDoc([
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ]),
      insertMode: 'replace',
      selectionSnapshot: {
        from: 1,
        to: 7,
        text: 'mismatch',
      },
    });

    expect(result.prosemirrorJson).toEqual(
      createDoc([
        { type: 'paragraph', content: [{ type: 'text', text: 'before text' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ]),
    );
    expect(result.appliedMode).toBe('append');
    expect(result.fallbackReason).toBe('stale_selection');
  });
});
