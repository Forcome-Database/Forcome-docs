import { useMemo } from "react";
import type { AiCreateSessionState } from "../components/ai-creator/ai-create-session.types";

export interface TaskApplyRollbackState {
  canApply: boolean;
  canRollback: boolean;
}

export function createInitialTaskApplyRollbackState(): TaskApplyRollbackState {
  return {
    canApply: false,
    canRollback: false,
  };
}

export function deriveTaskApplyRollbackState(
  state: AiCreateSessionState,
): TaskApplyRollbackState {
  return {
    canApply: state.documentTask.pendingChangeSet.length > 0,
    canRollback: state.documentTask.rollbackSnapshot !== null,
  };
}

export function useTaskApplyRollback(
  state: AiCreateSessionState,
): TaskApplyRollbackState {
  return useMemo(
    () => deriveTaskApplyRollbackState(state),
    [state.documentTask.pendingChangeSet.length, state.documentTask.rollbackSnapshot],
  );
}
