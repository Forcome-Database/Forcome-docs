import type {
  AgentAwaitInputData,
  AgentSSEEvent,
} from "../types/agent.types";
import type { AiCreateAwaitInputPhase } from "../components/ai-creator/ai-create-session.types";

export type AiCreateRunEvent =
  | { type: "task"; taskId: string | null }
  | { type: "session"; threadId: string }
  | { type: "step_start"; step: string; description: string }
  | { type: "step_done"; step: string; resultSummary?: string }
  | { type: "content_delta"; chunk: string }
  | { type: "content_cleared" }
  | { type: "await_input"; phase: AiCreateAwaitInputPhase; data: AgentAwaitInputData }
  | { type: "done"; finalContent?: string }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export function toAwaitInputPhase(phase: string): AiCreateAwaitInputPhase | null {
  if (phase === "clarify" || phase === "propose" || phase === "outline") {
    return phase;
  }

  return null;
}

function isAgentAwaitInputData(
  phase: AiCreateAwaitInputPhase,
  data: unknown,
): data is AgentAwaitInputData {
  if (!data || typeof data !== "object") {
    return false;
  }

  if (phase === "clarify") {
    return (
      (data as { type?: unknown }).type === "clarify" &&
      Array.isArray((data as { questions?: unknown }).questions)
    );
  }

  if (phase === "propose") {
    return (
      (data as { type?: unknown }).type === "propose" &&
      Array.isArray((data as { proposals?: unknown }).proposals)
    );
  }

  return (
    (data as { type?: unknown }).type === "outline" &&
    typeof (data as { outline?: unknown }).outline === "string"
  );
}

export function normalizeAgentRunEvent(event: AgentSSEEvent): AiCreateRunEvent | null {
  switch (event.type) {
    case "step_start":
      return {
        type: "step_start",
        step: event.step,
        description: event.description,
      };
    case "step_done":
      return {
        type: "step_done",
        step: event.step,
        resultSummary: event.result_summary,
      };
    case "content":
      return {
        type: "content_delta",
        chunk: event.chunk,
      };
    case "content_clear":
      return { type: "content_cleared" };
    case "image":
      return {
        type: "content_delta",
        chunk: `\n![${event.alt}](${event.url})\n`,
      };
    case "await_input": {
      const normalizedPhase = toAwaitInputPhase(event.phase);
      if (!normalizedPhase || !isAgentAwaitInputData(normalizedPhase, event.data)) {
        return null;
      }
      return {
        type: "await_input",
        phase: normalizedPhase,
        data: event.data,
      };
    }
    case "session":
      return {
        type: "session",
        threadId: event.thread_id,
      };
    case "error":
      return {
        type: "error",
        message: event.message,
      };
    case "done":
      return {
        type: "done",
        finalContent: event.final_content,
      };
    case "cancelled":
      return { type: "cancelled" };
    default:
      return null;
  }
}
