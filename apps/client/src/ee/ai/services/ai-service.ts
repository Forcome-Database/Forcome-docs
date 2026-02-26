import api from "@/lib/api-client.ts";
import {
  AiGenerateDto,
  AiContentResponse,
  AiStreamChunk,
  AiStreamError,
} from "@/ee/ai/types/ai.types.ts";

export interface CreatorGenerateParams {
  files: File[];
  prompt: string;
  template?: string;
  pageId: string;
  insertMode?: string;
  existingContentSummary?: string;
  pageTitle?: string;
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
  try {
    const response = await fetch("/api/ai/generate/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
      signal: abortController.signal,
      credentials: "include", // This ensures cookies are sent, matching axios withCredentials
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const processStream = async () => {
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
                onComplete?.();
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
      } catch (error) {
        if (error.name !== "AbortError") {
          onError?.({ error: error.message });
        }
      } finally {
        reader.releaseLock();
      }
    };

    processStream();
  } catch (error) {
    onError?.({ error: error.message });
  }

  return abortController;
}

export async function creatorGenerate(
  data: CreatorGenerateParams,
  onChunk: (chunk: AiStreamChunk) => void,
  onError?: (error: AiStreamError) => void,
  onComplete?: () => void,
): Promise<AbortController> {
  const abortController = new AbortController();

  try {
    const formData = new FormData();
    data.files.forEach((file) => formData.append("files", file));
    formData.append("prompt", data.prompt);
    if (data.template) formData.append("template", data.template);
    formData.append("pageId", data.pageId);
    if (data.insertMode) formData.append("insertMode", data.insertMode);
    if (data.existingContentSummary)
      formData.append("existingContentSummary", data.existingContentSummary);
    if (data.pageTitle) formData.append("pageTitle", data.pageTitle);

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

    const processStream = async () => {
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
                onComplete?.();
                return;
              }
              try {
                const parsed = JSON.parse(sseData);
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
      } catch (error: any) {
        if (error.name !== "AbortError") {
          onError?.({ error: error.message });
        }
      } finally {
        reader.releaseLock();
      }
    };

    processStream();
  } catch (error: any) {
    onError?.({ error: error.message });
  }

  return abortController;
}
