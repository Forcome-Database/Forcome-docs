import api from "@/lib/api-client.ts";
import {
  AiGenerateDto,
  AiContentResponse,
  AiStreamChunk,
  AiStreamError,
} from "@/ee/ai/types/ai.types.ts";

export interface CreatorHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CreatorGenerateParams {
  files: File[];
  prompt: string;
  template?: string;
  pageId: string;
  pageContent?: string;
  insertMode?: string;
  existingContentSummary?: string;
  pageTitle?: string;
  history?: CreatorHistoryMessage[];
  planningEnabled?: boolean;
  confirmedOutline?: string;
  intentRoute?: "selection_edit" | "document_transform" | "document_create";
  scope?: "selection" | "uploaded_document" | "current_page" | "blank_page";
  sourcePolicy?: "preserve_source" | "transform_source" | "create_new";
  lengthPolicy?: "preserve" | "compress" | "expand";
  prioritizeUserInstructions?: boolean;
}

export interface CreatorCommitSelectionSnapshot {
  text: string;
  from: number;
  to: number;
}

export interface CreatorCommitParams {
  pageId: string;
  content: string;
  insertMode: "create" | "append" | "overwrite" | "replace";
  expectedUpdatedAt: string;
  selectionSnapshot?: CreatorCommitSelectionSnapshot | null;
}

export interface CreatorCommitResponse {
  appliedMode: "append" | "overwrite" | "replace";
  fallbackReason: "stale_selection" | null;
  committedAt: string;
}

export async function generateAiContent(
  data: AiGenerateDto,
): Promise<AiContentResponse> {
  const req = await api.post<AiContentResponse>("/ai/generate", data);
  return req.data;
}

export async function generateAiContentStream(
  data: AiGenerateDto,
  onChunk: (chunk: AiStreamChunk) => void,
  onError?: (error: AiStreamError) => void,
  onComplete?: () => void,
): Promise<AbortController> {
  const abortController = new AbortController();

  (async () => {
    let completed = false;
    try {
      const response = await fetch("/api/ai/generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
        signal: abortController.signal,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("Response body is not readable");
      }

      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");

          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                if (!completed) { completed = true; onComplete?.(); }
                return;
              }
              try {
                const parsed = JSON.parse(data);
                if (parsed.error) {
                  onError?.(parsed);
                } else {
                  onChunk(parsed);
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
        if (!completed) { completed = true; onComplete?.(); }
      } finally {
        reader.releaseLock();
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        onError?.({ error: error.message });
      }
    }
  })();

  return abortController;
}

export async function creatorGenerate(
  data: CreatorGenerateParams,
  onChunk: (chunk: AiStreamChunk) => void,
  onError?: (error: AiStreamError) => void,
  onComplete?: () => void,
  onAwaitInput?: (phase: string, data: any) => void,
): Promise<AbortController> {
  const abortController = new AbortController();

  (async () => {
    let completed = false;
    try {
      const formData = new FormData();
      data.files.forEach((file) => formData.append("files", file));
      formData.append("prompt", data.prompt);
      if (data.template) formData.append("template", data.template);
      formData.append("pageId", data.pageId);
      if (data.pageContent) formData.append("pageContent", data.pageContent);
      if (data.insertMode) formData.append("insertMode", data.insertMode);
      if (data.existingContentSummary)
        formData.append("existingContentSummary", data.existingContentSummary);
      if (data.pageTitle) formData.append("pageTitle", data.pageTitle);
      if (data.history) formData.append("history", JSON.stringify(data.history));
      if (data.planningEnabled) formData.append("planningEnabled", "true");
      if (data.confirmedOutline) {
        formData.append("confirmedOutline", data.confirmedOutline);
      }
      if (data.intentRoute) formData.append("intentRoute", data.intentRoute);
      if (data.scope) formData.append("scope", data.scope);
      if (data.sourcePolicy) formData.append("sourcePolicy", data.sourcePolicy);
      if (data.lengthPolicy) formData.append("lengthPolicy", data.lengthPolicy);
      if (data.prioritizeUserInstructions !== undefined) {
        formData.append(
          "prioritizeUserInstructions",
          String(data.prioritizeUserInstructions),
        );
      }

      const response = await fetch("/api/ai/creator/generate", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("Response body is not readable");
      }

      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const sseData = line.slice(6);
              if (sseData === "[DONE]") {
                if (!completed) { completed = true; onComplete?.(); }
                return;
              }
              try {
                const parsed = JSON.parse(sseData);
                if (parsed.error || parsed.type === "error") {
                  const message = parsed.error || parsed.message || "Unknown error";
                  onError?.({ error: message });
                } else if (parsed.type === "await_input") {
                  onAwaitInput?.(parsed.phase, parsed.data);
                } else if (parsed.type === "done") {
                  if (!completed) { completed = true; onComplete?.(); }
                  return;
                } else if (parsed.type === "content_delta" && typeof parsed.chunk === "string") {
                  onChunk({ content: parsed.chunk });
                } else if (typeof parsed.content === "string") {
                  // Backward-compatibility for older creator stream payloads.
                  onChunk(parsed);
                } else {
                  // Ignore unknown event types in the standard creator flow.
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
        if (!completed) { completed = true; onComplete?.(); }
      } finally {
        reader.releaseLock();
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        onError?.({ error: error.message });
      }
    }
  })();

  return abortController;
}

export async function creatorCommit(
  data: CreatorCommitParams,
): Promise<CreatorCommitResponse> {
  const req = await api.post<CreatorCommitResponse>("/ai/creator/commit", data);
  return req.data;
}
