import { useCallback, useState } from "react";
import { rewriteInlineSelection } from "../services/inline-rewrite-service";
import type {
  AiCreateInlineRewriteState,
  AiCreateSessionState,
} from "../components/ai-creator/ai-create-session.types";

interface InlineRewriteParams {
  selectionSnapshot: string;
  localContext: string;
  action: string;
  taskSummaryRef?: {
    summary: string;
    includeRawHistory: false;
  };
}

interface InlineRewriteResult {
  candidate: string;
  riskFlags: string[];
  allowedActions: string[];
}

export function createInitialInlineRewriteState(): AiCreateInlineRewriteState {
  return {
    status: "idle",
    selectionSnapshot: null,
    candidateResult: null,
    actionType: null,
    taskSummaryRef: null,
  };
}

export function deriveInlineRewriteState(
  state: Pick<AiCreateSessionState, "inlineRewrite">,
): AiCreateInlineRewriteState {
  return state.inlineRewrite ?? createInitialInlineRewriteState();
}

export function useInlineRewrite() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const rewriteSelection = useCallback(
    async (params: InlineRewriteParams): Promise<InlineRewriteResult> => {
      setIsLoading(true);
      setError(null);

      try {
        return await rewriteInlineSelection(params);
      } catch (err) {
        const nextError =
          err instanceof Error ? err : new Error("Inline rewrite failed");
        setError(nextError);
        throw nextError;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setError(null);
    setIsLoading(false);
  }, []);

  return {
    rewriteSelection,
    isLoading,
    error,
    reset,
  };
}

export function useInlineRewriteSession(
  state: AiCreateSessionState,
): AiCreateInlineRewriteState {
  return deriveInlineRewriteState(state);
}
