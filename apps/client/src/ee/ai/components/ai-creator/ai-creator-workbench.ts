import type {
  AgentResumeValue,
  AgentSessionAwaitInputState,
} from "../../types/agent.types";

interface ResolveBlockedWorkbenchActionParams {
  resolution: string;
  hasBlueprint: boolean;
  hasReview: boolean;
}

type BlockedWorkbenchAction =
  | { kind: "open_blueprint" }
  | { kind: "open_review" }
  | { kind: "resume_block"; resumeValue: AgentResumeValue };

export function resolveBlockedWorkbenchAction({
  resolution,
  hasBlueprint,
  hasReview,
}: ResolveBlockedWorkbenchActionParams): BlockedWorkbenchAction {
  if (
    hasReview &&
    (resolution === "fix_selected_issues" || resolution === "skip_visual_issues")
  ) {
    return { kind: "open_review" };
  }

  if (hasBlueprint && resolution === "update_blueprint") {
    return { kind: "open_blueprint" };
  }

  return {
    kind: "resume_block",
    resumeValue: {
      type: "resolve_block",
      resolution,
    },
  };
}

interface ShouldRenderWorkbenchModalParams {
  opened: boolean;
  hasData: boolean;
  awaitPhase: AgentSessionAwaitInputState["phase"] | null;
  expectedPhase: AgentSessionAwaitInputState["phase"];
  isBlocked: boolean;
}

export function shouldRenderWorkbenchModal({
  opened,
  hasData,
  awaitPhase,
  expectedPhase,
  isBlocked,
}: ShouldRenderWorkbenchModalParams): boolean {
  if (!opened || !hasData) {
    return false;
  }

  return awaitPhase === expectedPhase || isBlocked;
}
