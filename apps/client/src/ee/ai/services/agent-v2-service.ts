import type { AgentV2Event, AgentV2RunRequest } from "../types/agent-v2.types";

/** 将 File 对象转为 base64 字符串 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** 解析一行 SSE 数据 */
function parseSseLine(line: string): AgentV2Event | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data: ")) return null;
  const json = trimmed.slice(6);
  if (json === "[DONE]") return null;
  try {
    return JSON.parse(json) as AgentV2Event;
  } catch {
    return null;
  }
}

/** 消费 SSE buffer，返回剩余未完成的部分 */
function consumeBuffer(
  buffer: string,
  onEvent: (event: AgentV2Event) => void,
): string {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    const event = parseSseLine(line);
    if (event) onEvent(event);
  }
  return remainder;
}

/** 发送 Agent V2 请求并流式接收 SSE 事件 */
export function agentV2Run(
  params: {
    prompt: string;
    pageId?: string;
    threadId?: string;
    pageContent?: string;
    files?: File[];
    selection?: {
      editMode: string;
      selectedText?: string;
      contextBefore?: string;
      contextAfter?: string;
      documentOutline?: string;
    };
  },
  onEvent: (event: AgentV2Event) => void,
  onError: (error: string) => void,
  onComplete: () => void,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const filePayloads = await Promise.all(
        (params.files ?? []).map(async (f) => ({
          content_b64: await fileToBase64(f),
          filename: f.name,
          mimetype: f.type || "application/octet-stream",
        })),
      );

      const body: AgentV2RunRequest = {
        prompt: params.prompt,
        pageId: params.pageId,
        threadId: params.threadId,
        pageContent: params.pageContent,
        files: filePayloads.length > 0 ? filePayloads : undefined,
        editMode: params.selection?.editMode as AgentV2RunRequest["editMode"],
        selectedText: params.selection?.selectedText,
        contextBefore: params.selection?.contextBefore,
        contextAfter: params.selection?.contextAfter,
        documentOutline: params.selection?.documentOutline,
      };

      const response = await fetch("/api/agent/v2/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        credentials: "include",
      });

      if (!response.ok) {
        const text = await response.text();
        onError(`Agent service error: ${response.status} ${text}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError("No response body");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = consumeBuffer(buffer, onEvent);
        }

        if (buffer.trim()) {
          const event = parseSseLine(buffer);
          if (event) onEvent(event);
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      onComplete();
    }
  })();

  return controller;
}
