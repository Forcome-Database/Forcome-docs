import type { AgentStepInfo } from "../../types/agent.types";

export type AgentStepEvent =
  | { type: "step_start"; step: string; description: string }
  | { type: "step_done"; step: string; resultSummary?: string };

interface ApplyAgentStepEventResult {
  steps: AgentStepInfo[];
  replayedStep: string | null;
}

export function applyAgentStepEvent(
  steps: AgentStepInfo[],
  event: AgentStepEvent,
  replayedStep: string | null,
): ApplyAgentStepEventResult {
  if (replayedStep && event.step === replayedStep) {
    return {
      steps,
      replayedStep,
    };
  }

  const nextSteps = [...steps];
  const index = nextSteps.findIndex(
    (item) => item.step === event.step && item.status !== "done",
  );

  if (index >= 0) {
    nextSteps[index] = {
      ...nextSteps[index],
      ...(event.type === "step_start"
        ? {
            description: event.description,
            status: "running" as const,
            startTime: nextSteps[index].startTime ?? Date.now(),
          }
        : {
            status: "done" as const,
            resultSummary: event.resultSummary,
          }),
    };
  } else {
    nextSteps.push({
      step: event.step,
      description: event.type === "step_start" ? event.description : "",
      status: event.type === "step_start" ? "running" : "done",
      resultSummary:
        event.type === "step_done" ? event.resultSummary : undefined,
      startTime: event.type === "step_start" ? Date.now() : undefined,
    });
  }

  return {
    steps: nextSteps,
    replayedStep: replayedStep ? null : replayedStep,
  };
}
