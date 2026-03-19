import type {
  CreatorCommitParams,
  CreatorCommitResponse,
} from "../services/ai-service";

export interface AiCreatePageSnapshot {
  bodyJson: string;
  title: string;
}

function normalizePageVersion(value?: string | Date | null): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializeEditorDoc(editor: any): string {
  if (!editor?.state?.doc?.toJSON) {
    return "";
  }

  return JSON.stringify(editor.state.doc.toJSON());
}

function readTitleText(titleEditor: any): string {
  return titleEditor?.state?.doc?.textContent?.trim?.() ?? "";
}

function isConflictError(error: any): boolean {
  return error?.response?.status === 409;
}

export function captureAiCreatePageSnapshot(
  editor: any,
  titleEditor: any,
): AiCreatePageSnapshot | null {
  if (!editor) {
    return null;
  }

  return {
    bodyJson: serializeEditorDoc(editor),
    title: readTitleText(titleEditor),
  };
}

export function pageSnapshotMatchesCurrentEditor(
  snapshot: AiCreatePageSnapshot | null,
  editor: any,
  titleEditor: any,
): boolean {
  if (!snapshot || !editor) {
    return false;
  }

  return (
    snapshot.bodyJson === serializeEditorDoc(editor) &&
    snapshot.title === readTitleText(titleEditor)
  );
}

export async function commitDraftWithRecovery(args: {
  pageId: string;
  content: string;
  insertMode: CreatorCommitParams["insertMode"];
  expectedUpdatedAt: string | null;
  selectionSnapshot?: CreatorCommitParams["selectionSnapshot"];
  pageSnapshot: AiCreatePageSnapshot | null;
  editor: any;
  titleEditor: any;
  commit: (
    params: CreatorCommitParams,
  ) => Promise<CreatorCommitResponse>;
  fetchLatestPage: (
    pageId: string,
  ) => Promise<{ updatedAt?: string | Date | null }>;
}): Promise<
  | {
      ok: true;
      result: CreatorCommitResponse;
      retriedWithLatestVersion: boolean;
    }
  | {
      ok: false;
      reason: "missing_version" | "conflict" | "error";
      error?: any;
    }
> {
  const {
    pageId,
    content,
    insertMode,
    expectedUpdatedAt,
    selectionSnapshot,
    pageSnapshot,
    editor,
    titleEditor,
    commit,
    fetchLatestPage,
  } = args;

  if (!expectedUpdatedAt) {
    return { ok: false, reason: "missing_version" };
  }

  const commitParams: CreatorCommitParams = {
    pageId,
    content,
    insertMode,
    expectedUpdatedAt,
    selectionSnapshot: selectionSnapshot ?? null,
  };

  try {
    const result = await commit(commitParams);
    return { ok: true, result, retriedWithLatestVersion: false };
  } catch (error) {
    if (
      !isConflictError(error) ||
      !pageSnapshotMatchesCurrentEditor(pageSnapshot, editor, titleEditor)
    ) {
      return {
        ok: false,
        reason: isConflictError(error) ? "conflict" : "error",
        error,
      };
    }

    try {
      const latestPage = await fetchLatestPage(pageId);
      const latestUpdatedAt = normalizePageVersion(latestPage.updatedAt);

      if (
        !latestUpdatedAt ||
        latestUpdatedAt === expectedUpdatedAt ||
        !pageSnapshotMatchesCurrentEditor(pageSnapshot, editor, titleEditor)
      ) {
        return { ok: false, reason: "conflict", error };
      }

      const result = await commit({
        ...commitParams,
        expectedUpdatedAt: latestUpdatedAt,
      });
      return { ok: true, result, retriedWithLatestVersion: true };
    } catch (retryError) {
      return {
        ok: false,
        reason: isConflictError(retryError) ? "conflict" : "error",
        error: retryError,
      };
    }
  }
}
