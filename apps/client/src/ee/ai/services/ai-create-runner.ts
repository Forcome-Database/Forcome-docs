import type { CreatorGenerateParams } from "./ai-service";
import { creatorGenerate } from "./ai-service";
import type {
  AgentGenerateParams,
  AgentLegacyRunPayload,
} from "./agent-service";
import {
  agentGenerate,
  agentGenerateFromShellRequest,
  resumeAgent,
  stopAgentTask,
} from "./agent-service";
import {
  applyDocumentTaskAcceptedChanges as applyDocumentTaskAcceptedChangesRequest,
  createDocumentTask as createDocumentTaskRequest,
  requestDocumentTaskDiff as requestDocumentTaskDiffRequest,
  requestDocumentTaskPlan as requestDocumentTaskPlanRequest,
  resolveDocumentTaskCollabDecision as resolveDocumentTaskCollabDecisionRequest,
  rollbackDocumentTaskAppliedChanges as rollbackDocumentTaskAppliedChangesRequest,
  submitDocumentTaskReview as submitDocumentTaskReviewRequest,
} from "./document-task-service";
import { rewriteInlineSelection as rewriteInlineSelectionRequest } from "./inline-rewrite-service";
import type { AgentResumeValue } from "../types/agent.types";
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

export function runDocumentTaskAgent(
  payload: AgentLegacyRunPayload,
  onEvent: (event: AiCreateRunEvent) => void,
): AbortController {
  return agentGenerateFromShellRequest(
    payload,
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
  sessionId: string,
  resumeValue: AgentResumeValue,
  onEvent: (event: AiCreateRunEvent) => void,
): AbortController {
  return resumeAgent(
    sessionId,
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

export const createDocumentTask = createDocumentTaskRequest;
export const requestDocumentTaskPlan = requestDocumentTaskPlanRequest;
export const requestDocumentTaskDiff = requestDocumentTaskDiffRequest;
export const submitDocumentTaskReview = submitDocumentTaskReviewRequest;
export const applyDocumentTaskAcceptedChanges =
  applyDocumentTaskAcceptedChangesRequest;
export const rollbackDocumentTaskAppliedChanges =
  rollbackDocumentTaskAppliedChangesRequest;
export const resolveDocumentTaskCollabDecision =
  resolveDocumentTaskCollabDecisionRequest;
export const rewriteInlineSelection = rewriteInlineSelectionRequest;
