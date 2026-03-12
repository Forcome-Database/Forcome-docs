import type { CreatorGenerateParams } from "./ai-service";
import { creatorGenerate } from "./ai-service";
import type { AgentGenerateParams } from "./agent-service";
import {
  agentGenerate,
  resumeAgent,
  stopAgentTask,
} from "./agent-service";
import {
  type AiCreateRunEvent,
  normalizeAgentRunEvent,
  toAwaitInputPhase,
} from "./ai-create-runner.utils";
export type { AiCreateRunEvent } from "./ai-create-runner.utils";

export async function runStandardAiCreate(
  params: CreatorGenerateParams,
  onEvent: (event: AiCreateRunEvent) => void,
): Promise<AbortController> {
  return creatorGenerate(
    params,
    (chunk) => {
      onEvent({ type: "content_delta", chunk: chunk.content });
    },
    (error) => {
      onEvent({ type: "error", message: error.error });
    },
    () => {
      onEvent({ type: "done" });
    },
    (phase, data) => {
      const normalizedPhase = toAwaitInputPhase(phase);
      if (!normalizedPhase) {
        return;
      }

      onEvent({
        type: "await_input",
        phase: normalizedPhase,
        data,
      });
    },
  );
}

export function runAgentAiCreate(
  params: AgentGenerateParams,
  onEvent: (event: AiCreateRunEvent) => void,
): AbortController {
  return agentGenerate(
    params,
    (event) => {
      const normalized = normalizeAgentRunEvent(event);
      if (normalized) {
        onEvent(normalized);
      }
    },
    (message) => {
      onEvent({ type: "error", message });
    },
    () => {},
    (taskId) => {
      onEvent({ type: "task", taskId });
    },
  );
}

export function resumeAgentAiCreate(
  threadId: string,
  resumeValue: Record<string, any>,
  onEvent: (event: AiCreateRunEvent) => void,
): AbortController {
  return resumeAgent(
    threadId,
    resumeValue,
    (event) => {
      const normalized = normalizeAgentRunEvent(event);
      if (normalized) {
        onEvent(normalized);
      }
    },
    (message) => {
      onEvent({ type: "error", message });
    },
    () => {},
    (taskId) => {
      onEvent({ type: "task", taskId });
    },
  );
}

export async function stopAgentAiCreateTask(taskId: string): Promise<void> {
  await stopAgentTask(taskId);
}
