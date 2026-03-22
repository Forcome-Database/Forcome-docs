import type {
  DocumentTaskMode,
  DocumentTaskSourceScope,
} from "../types/document-task.types";

interface DocumentTaskShellResponse {
  taskId: string;
  operation: string;
  task: {
    taskId: string;
    taskType: "document_transform" | "document_create";
    sourceScope: DocumentTaskSourceScope;
    mode: DocumentTaskMode;
    status: string;
  };
  adapterRequest?: Record<string, unknown>;
}

interface CreateDocumentTaskParams {
  prompt: string;
  pageId: string;
  pageTitle?: string;
  pageContent?: string;
  taskType?: "document_transform" | "document_create";
  sourceScope: DocumentTaskSourceScope;
  mode: DocumentTaskMode;
  files?: File[];
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Document task request failed: ${response.status}`);
  }

  const payload = (await response.json()) as
    | T
    | {
        data?: T;
      };

  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload.data as T) ?? (payload as T);
  }

  return payload as T;
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return readJsonResponse<T>(response);
}

export async function createDocumentTask(
  params: CreateDocumentTaskParams,
): Promise<DocumentTaskShellResponse> {
  if (params.files && params.files.length > 0) {
    const formData = new FormData();
    formData.append("prompt", params.prompt);
    formData.append("pageId", params.pageId);
    if (params.taskType) formData.append("taskType", params.taskType);
    formData.append("sourceScope", params.sourceScope);
    formData.append("mode", params.mode);
    if (params.pageTitle) formData.append("pageTitle", params.pageTitle);
    if (params.pageContent) formData.append("pageContent", params.pageContent);
    for (const file of params.files) {
      formData.append("files", file);
    }

    const response = await fetch("/api/ai/document-tasks", {
      method: "POST",
      body: formData,
    });
    return readJsonResponse<DocumentTaskShellResponse>(response);
  }

  return postJson<DocumentTaskShellResponse>("/api/ai/document-tasks", {
    prompt: params.prompt,
    pageId: params.pageId,
    pageTitle: params.pageTitle,
    pageContent: params.pageContent,
    taskType: params.taskType,
    sourceScope: params.sourceScope,
    mode: params.mode,
  });
}

export async function requestDocumentTaskPlan(
  taskId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return postJson(`/api/ai/document-tasks/${taskId}/plan`, payload);
}

export async function requestDocumentTaskDiff(
  taskId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return postJson(`/api/ai/document-tasks/${taskId}/diff`, payload);
}

export async function submitDocumentTaskReview(
  taskId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return postJson(`/api/ai/document-tasks/${taskId}/review`, payload);
}

export async function applyDocumentTaskAcceptedChanges(
  taskId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return postJson(`/api/ai/document-tasks/${taskId}/apply`, payload);
}

export async function rollbackDocumentTaskAppliedChanges(
  taskId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return postJson(`/api/ai/document-tasks/${taskId}/rollback`, payload);
}

export async function resolveDocumentTaskCollabDecision(
  taskId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return postJson(`/api/ai/document-tasks/${taskId}/collab`, payload);
}
