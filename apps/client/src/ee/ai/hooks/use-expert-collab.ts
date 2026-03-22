import { useMemo } from "react";
import type {
  AiCreateExpertCollabState,
  AiCreateSessionState,
} from "../components/ai-creator/ai-create-session.types";

export function createInitialExpertCollabState(): AiCreateExpertCollabState {
  return {
    status: "idle",
    reason: null,
    question: null,
    options: [],
    recommendedOption: null,
    confirmedDecision: null,
    genericMessage: null,
  };
}

export function deriveExpertCollabState(
  state: Pick<AiCreateSessionState, "awaitInput" | "documentTask">,
): AiCreateExpertCollabState {
  if (!state.awaitInput || !state.documentTask.deepCollaborationEnabled) {
    return createInitialExpertCollabState();
  }

  return {
    status: "awaiting_decision",
    reason: state.awaitInput.phase,
    question: `Confirm ${state.awaitInput.phase}`,
    options: [{ id: "confirm" }, { id: "revise" }],
    recommendedOption: "confirm",
    confirmedDecision: null,
    genericMessage: null,
  };
}

export function useExpertCollab(state: AiCreateSessionState): AiCreateExpertCollabState {
  return useMemo(
    () => state.expertCollab ?? deriveExpertCollabState(state),
    [state],
  );
}
