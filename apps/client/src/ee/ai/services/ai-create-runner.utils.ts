import type { AgentSSEEvent } from "../types/agent.types";
import type { AiCreateAwaitInputPhase } from "../components/ai-creator/ai-create-session.types";

export type AiCreateRunEvent =
  | { type: "task"; taskId: string | null }
  | { type: "session"; threadId: string }
  | { type: "step_start"; step: string; description: string }
  | { type: "step_done"; step: string; resultSummary?: string }
  | { type: "content_delta"; chunk: string }
  | { type: "content_cleared" }
  | { type: "await_input"; phase: AiCreateAwaitInputPhase; data: any }
  | { type: "done"; finalContent?: string }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export function toAwaitInputPhase(phase: string): AiCreateAwaitInputPhase | null {
  if (phase === "clarify" || phase === "propose" || phase === "outline") {
    return phase;
  }

  return null;
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
      if (!normalizedPhase) {
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
