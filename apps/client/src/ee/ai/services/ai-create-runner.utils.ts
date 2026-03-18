import type {
  AgentAwaitInputData,
  AgentDraftPatchSection,
  AgentSSEEvent,
} from "../types/agent.types";
import type { AiCreateAwaitInputPhase } from "../components/ai-creator/ai-create-session.types";
import type { SSEEventV2 } from '../types/events-v2.types';

export type AiCreateRunEvent =
  | { type: "task"; taskId: string | null }
  | { type: "session"; sessionId: string; threadId: string }
  | { type: "step_start"; step: string; description: string }
  | { type: "step_done"; step: string; resultSummary?: string }
  | { type: "content_delta"; chunk: string }
  | { type: "content_cleared" }
  | { type: "draft_patch"; markdown: string; sections: AgentDraftPatchSection[] }
  | { type: "await_input"; phase: AiCreateAwaitInputPhase; data: AgentAwaitInputData }
  | { type: "done"; finalContent?: string }
  | { type: "error"; message: string }
  | { type: "blocked"; kind: string; message: string; requiredAction: string; allowedResolutions: string[] }
  | { type: "cancelled" };

export function toAwaitInputPhase(phase: string): AiCreateAwaitInputPhase | null {
  if (phase === "brief" || phase === "blueprint" || phase === "review") {
    return phase;
  }

  return null;
}

function normalizeAwaitInputData(
  phase: AiCreateAwaitInputPhase,
  data: unknown,
): AgentAwaitInputData | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  if ((data as { type?: unknown }).type !== phase) {
    return null;
  }
  return data as AgentAwaitInputData;
}

function normalizeDraftPatchSections(data: unknown): AgentDraftPatchSection[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const sectionId = typeof (item as { section_id?: unknown }).section_id === "string"
      ? (item as { section_id: string }).section_id
      : null;
    const title = typeof (item as { title?: unknown }).title === "string"
      ? (item as { title: string }).title
      : null;
    const level = typeof (item as { level?: unknown }).level === "number"
      ? (item as { level: number }).level
      : 2;
    const content = typeof (item as { content?: unknown }).content === "string"
      ? (item as { content: string }).content
      : null;

    if (!sectionId || !title || content === null) {
      return [];
    }

    return [{ sectionId, title, level, content }];
  });
}

/**
 * Normalize a v2 SSE event into the internal AiCreateRunEvent format.
 * This enables the existing handleRunEvent in use-ai-create-session.ts
 * to process v2 events without major changes.
 */
export function normalizeV2Event(event: SSEEventV2): AiCreateRunEvent | null {
  switch (event.type) {
    case 'step_start':
      return {
        type: 'step_start',
        step: event.step_name,
        description: event.description || '',
      };
    case 'step_done':
      return {
        type: 'step_done',
        step: event.step_name,
        resultSummary: event.result_summary || '',
      };
    case 'content_delta':
      return { type: 'content_delta', chunk: event.chunk || '' };
    case 'content_cleared':
      return { type: 'content_cleared' };
    case 'section_progress':
      return {
        type: 'step_start',
        step: `writing_section_${event.current}`,
        description: event.section_title || `Section ${event.current}/${event.total}`,
      };
    case 'await_user_input': {
      const phase = toAwaitInputPhase(event.phase);
      if (!phase) return null;
      return {
        type: 'await_input',
        phase,
        data: event.data as any,
      };
    }
    case 'done':
      return {
        type: 'done',
        finalContent: event.final_content || '',
      };
    case 'error':
      return {
        type: 'error',
        message: event.error_message || 'Unknown error',
      };
    case 'cancelled':
      return { type: 'cancelled' };
    case 'complexity_analyzed':
      return {
        type: 'step_done',
        step: 'analyze_complexity',
        resultSummary: `Level ${event.level}`,
      };
    default:
      return null;
  }
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
    case "fix_applied":
      return {
        type: "step_done",
        step: `fix_issue_${event.issue_id}`,
        resultSummary: event.success ? "Issue fixed" : "Issue fix failed",
      };
    case "await_input": {
      const normalizedPhase = toAwaitInputPhase(event.phase);
      const normalizedData = normalizedPhase
        ? normalizeAwaitInputData(normalizedPhase, event.data)
        : null;
      if (!normalizedPhase || !normalizedData) {
        return null;
      }
      return {
        type: "await_input",
        phase: normalizedPhase,
        data: normalizedData,
      };
    }
    case "session":
      return {
        type: "session",
        sessionId: event.session_id || event.thread_id,
        threadId: event.thread_id,
      };
    case "draft_patch":
      return {
        type: "draft_patch",
        markdown: event.markdown,
        sections: normalizeDraftPatchSections(event.sections),
      };
    case "error":
      return {
        type: "error",
        message: event.message,
      };
    case "blocked":
      return {
        type: "blocked",
        kind: event.kind || "general",
        message: event.message,
        requiredAction: event.required_action || "",
        allowedResolutions: event.allowed_resolutions || [],
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
