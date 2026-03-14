import type {
  AgentAwaitInputData,
  AgentDocumentArtifact,
  AgentOutlineArtifactPlanItem,
  AgentSSEEvent,
} from "../types/agent.types";
import type { AiCreateAwaitInputPhase } from "../components/ai-creator/ai-create-session.types";
import type { SSEEventV2 } from '../types/events-v2.types';

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
  | { type: "blocked"; message: string }
  | { type: "cancelled" };

type RawClarifyAwaitInputData = {
  type: "clarify";
  questions: string[];
};

type RawProposeAwaitInputData = {
  type: "propose";
  proposals: { title: string; description: string }[];
};

type RawOutlineArtifactPlanItem = {
  sectionId?: unknown;
  section_id?: unknown;
  sectionTitle?: unknown;
  section_title?: unknown;
  artifacts?: unknown;
};

type RawOutlineAwaitInputData = {
  type: "outline";
  outline: string;
  artifactPlan?: unknown;
  artifact_plan?: unknown;
};

type RawAwaitInputData =
  | RawClarifyAwaitInputData
  | RawProposeAwaitInputData
  | RawOutlineAwaitInputData;

export function toAwaitInputPhase(phase: string): AiCreateAwaitInputPhase | null {
  if (phase === "clarify" || phase === "propose" || phase === "outline") {
    return phase;
  }

  return null;
}

function isRawAwaitInputData(
  phase: AiCreateAwaitInputPhase,
  data: unknown,
): data is RawAwaitInputData {
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

function isDocumentArtifact(value: unknown): value is AgentDocumentArtifact {
  return (
    value === "table" ||
    value === "mermaid" ||
    value === "code_block" ||
    value === "image" ||
    value === "callout" ||
    value === "details"
  );
}

function normalizeOutlineArtifactPlanItem(
  item: RawOutlineArtifactPlanItem,
): AgentOutlineArtifactPlanItem | null {
  const sectionId =
    typeof item.sectionId === "string"
      ? item.sectionId
      : typeof item.section_id === "string"
        ? item.section_id
        : null;
  const sectionTitle =
    typeof item.sectionTitle === "string"
      ? item.sectionTitle
      : typeof item.section_title === "string"
        ? item.section_title
        : null;
  const artifacts = Array.isArray(item.artifacts)
    ? item.artifacts.filter(isDocumentArtifact)
    : [];

  if (!sectionId || !sectionTitle) {
    return null;
  }

  return {
    sectionId,
    sectionTitle,
    artifacts,
  };
}

function normalizeOutlineArtifactPlan(
  data: RawOutlineAwaitInputData,
): AgentOutlineArtifactPlanItem[] {
  const rawPlan = Array.isArray(data.artifactPlan)
    ? data.artifactPlan
    : Array.isArray(data.artifact_plan)
      ? data.artifact_plan
      : [];

  return rawPlan.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const normalizedItem = normalizeOutlineArtifactPlanItem(
      item as RawOutlineArtifactPlanItem,
    );
    return normalizedItem ? [normalizedItem] : [];
  });
}

function normalizeAwaitInputData(
  phase: AiCreateAwaitInputPhase,
  data: unknown,
): AgentAwaitInputData | null {
  if (!isRawAwaitInputData(phase, data)) {
    return null;
  }

  if (phase === "clarify") {
    return data;
  }

  if (phase === "propose") {
    return data;
  }

  return {
    type: "outline",
    outline: data.outline,
    artifactPlan: normalizeOutlineArtifactPlan(data),
  };
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
        threadId: event.thread_id,
      };
    case "error":
      return {
        type: "error",
        message: event.message,
      };
    case "blocked":
      return {
        type: "blocked",
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
