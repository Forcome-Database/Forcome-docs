import { Injectable, Logger } from '@nestjs/common';
import { Hocuspocus, Document } from '@hocuspocus/server';
import { TiptapTransformer } from '@hocuspocus/transformer';
import {
  prosemirrorNodeToYElement,
  tiptapExtensions,
} from './collaboration.util';
import * as Y from 'yjs';
import { User } from '@docmost/db/types/entity.types';
import {
  AiCommitInsertMode,
  AiCommitSelectionSnapshot,
  applyAiCommitToDocument,
} from '../ee/ai/creator-commit.utils';

export type CollabEventHandlers = ReturnType<
  CollaborationHandler['getHandlers']
>;
export type CollabEventName = keyof CollabEventHandlers;
export type CollabEventPayload<TName extends CollabEventName> = Parameters<
  CollabEventHandlers[TName]
>[1];
export type CollabEventResult<TName extends CollabEventName> = Awaited<
  ReturnType<CollabEventHandlers[TName]>
>;

@Injectable()
export class CollaborationHandler {
  private readonly logger = new Logger(CollaborationHandler.name);

  constructor() {}

  getHandlers(hocuspocus: Hocuspocus) {
    return {
      alterState: async (documentName: string, payload: { pageId: string }) => {
        // dummy
        // this.logger.log('Processing', documentName, payload);
        // await this.withYdocConnection(hocuspocus, documentName, {}, (doc) => {
        //   const fragment = doc.getXmlFragment('default');
        //});
      },
      updatePageContent: async (
        documentName: string,
        payload: {
          prosemirrorJson: any;
          operation: string;
          user: User;
        },
      ) => {
        const { prosemirrorJson, operation, user } = payload;
        this.logger.debug('Updating page content via yjs', documentName);
        await this.withYdocConnection(
          hocuspocus,
          documentName,
          { user },
          (doc) => {
            const fragment = doc.getXmlFragment('default');

            if (operation === 'replace') {
              if (fragment.length > 0) {
                fragment.delete(0, fragment.length);
              }

              const newDoc = TiptapTransformer.toYdoc(
                prosemirrorJson,
                'default',
                tiptapExtensions,
              );
              Y.applyUpdate(doc, Y.encodeStateAsUpdate(newDoc));
            } else {
              const newContent = prosemirrorJson.content || [];
              const yElements = newContent.map(prosemirrorNodeToYElement);
              const position =
                operation === 'prepend' ? 0 : fragment.length;
              fragment.insert(position, yElements);
            }
          },
        );
      },
      applyAiCommit: async (
        documentName: string,
        payload: {
          prosemirrorJson: any;
          insertMode: AiCommitInsertMode;
          selectionSnapshot?: AiCommitSelectionSnapshot | null;
          user: User;
        },
      ) => {
        const { prosemirrorJson, insertMode, selectionSnapshot, user } =
          payload;

        return this.withYdocConnection(
          hocuspocus,
          documentName,
          { user },
          (doc) => {
            const fragment = doc.getXmlFragment('default');
            const currentDocument = TiptapTransformer.fromYdoc(doc, 'default');
            const result = applyAiCommitToDocument({
              currentDocument,
              incomingDocument: prosemirrorJson,
              insertMode,
              selectionSnapshot,
            });

            if (fragment.length > 0) {
              fragment.delete(0, fragment.length);
            }

            const nextDoc = TiptapTransformer.toYdoc(
              result.prosemirrorJson,
              'default',
              tiptapExtensions,
            );
            Y.applyUpdate(doc, Y.encodeStateAsUpdate(nextDoc));

            return result;
          },
        );
      },
    };
  }

  async withYdocConnection<TResult>(
    hocuspocus: Hocuspocus,
    documentName: string,
    context: any = {},
    fn: (doc: Document) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    const connection = await hocuspocus.openDirectConnection(
      documentName,
      context,
    );
    let result: TResult | undefined;
    let callbackError: unknown;
    try {
      await connection.transact(async (doc) => {
        try {
          result = await fn(doc);
        } catch (err) {
          callbackError = err;
        }
      });
      if (callbackError !== undefined) throw callbackError;
      return result as TResult;
    } finally {
      await connection.disconnect();
    }
  }
}
