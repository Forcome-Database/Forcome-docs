import type { CreationBlueprint } from "./blueprint.types";
import type { CreationBrief } from "./brief.types";
import type { ReviewReport } from "./review.types";

export interface AgentStepInfo {
  step: string;
  description: string;
  status: 'running' | 'done' | 'error' | 'pending';
  resultSummary?: string;
}

export interface AgentProposalOption {
  title: string;
  description: string;
}

export type AgentDocumentArtifact =
  | 'table'
  | 'mermaid'
  | 'code_block'
  | 'image'
  | 'callout'
  | 'details';

export interface AgentOutlineArtifactPlanItem {
  sectionId: string;
  sectionTitle: string;
  artifacts: AgentDocumentArtifact[];
}

export interface AgentClarifyAwaitInputData {
  type: 'clarify';
  questions: string[];
}

export interface AgentProposeAwaitInputData {
  type: 'propose';
  proposals: AgentProposalOption[];
}

export interface AgentOutlineAwaitInputData {
  type: 'outline';
  outline: string;
  artifactPlan?: AgentOutlineArtifactPlanItem[];
}

export interface AgentAssetSummary {
  images: number;
  tables: number;
  code: number;
  text: number;
  source_word_count: number;
  source_section_counts: Record<string, number>;
}

export interface AgentBriefAwaitInputData {
  type: "brief";
  brief: CreationBrief;
  asset_summary?: AgentAssetSummary;
}

export interface AgentBlueprintAwaitInputData {
  type: "blueprint";
  blueprint: CreationBlueprint;
}

export interface AgentReviewAwaitInputData {
  type: "review";
  report: ReviewReport;
}

export interface AgentBlockState {
  kind: string;
  message: string;
  requiredAction: string;
  allowedResolutions: string[];
}

export interface AgentDraftPatchSection {
  sectionId: string;
  title: string;
  level: number;
  content: string;
}

export type AgentAwaitInputData =
  | AgentBriefAwaitInputData
  | AgentBlueprintAwaitInputData
  | AgentReviewAwaitInputData;

export interface AgentConfirmBriefResumeValue {
  type: "confirm_brief";
  brief: Record<string, unknown>;
}

export interface AgentConfirmBlueprintResumeValue {
  type: "confirm_blueprint";
  blueprint: Record<string, unknown> | null;
}

export interface AgentApplyBlueprintPatchResumeValue {
  type: "apply_blueprint_patch";
  blueprint: Record<string, unknown> | null;
  feedback?: string;
}

export interface AgentFixSelectedIssuesResumeValue {
  type: "fix_selected_issues";
  selected_issue_ids: string[];
  feedback?: string;
}

export interface AgentResolveBlockResumeValue {
  type: "resolve_block";
  resolution: string;
  context?: Record<string, unknown>;
}

export interface AgentSkipIssueResumeValue {
  type: "skip_issue";
  issue_id: string;
  feedback?: string;
}

export type AgentResumeValue =
  | AgentConfirmBriefResumeValue
  | AgentConfirmBlueprintResumeValue
  | AgentApplyBlueprintPatchResumeValue
  | AgentFixSelectedIssuesResumeValue
  | AgentResolveBlockResumeValue
  | AgentSkipIssueResumeValue;

export type AgentSSEEvent =
  | {
      type: 'step_start';
      step: string;
      description: string;
    }
  | {
      type: 'step_done';
      step: string;
      result_summary: string;
    }
  | {
      type: 'content';
      chunk: string;
    }
  | {
      type: 'content_clear';
    }
  | {
      type: 'image';
      url: string;
      alt: string;
    }
  | {
      type: 'tool_call';
      tool: string;
      args?: Record<string, unknown>;
    }
  | {
      type: 'fix_applied';
      issue_id: string;
      section_id?: string | null;
      success: boolean;
    }
  | {
      type: 'error';
      message: string;
    }
  | {
      type: 'blocked';
      kind?: string;
      message: string;
      required_action?: string;
      allowed_resolutions?: string[];
    }
  | {
      type: 'done';
      final_content: string;
      insert_mode?: string;
    }
  | {
      type: 'await_input';
      phase: 'brief' | 'blueprint' | 'review' | string;
      data: AgentAwaitInputData | Record<string, unknown>;
    }
  | {
      type: 'session';
      session_id?: string;
      thread_id: string;
    }
  | {
      type: 'draft_patch';
      markdown: string;
      sections: Array<{
        section_id: string;
        title: string;
        level: number;
        content: string;
      }>;
    }
  | {
      type: 'cancelled';
    };
