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

export type AgentAwaitInputData =
  | AgentClarifyAwaitInputData
  | AgentProposeAwaitInputData
  | AgentOutlineAwaitInputData
  | AgentBriefAwaitInputData
  | AgentBlueprintAwaitInputData
  | AgentReviewAwaitInputData;

export interface AgentBriefResumeValue {
  type: "brief";
  brief: Record<string, unknown>;
}

export interface AgentBlueprintResumeValue {
  type: "blueprint";
  blueprint: Record<string, unknown> | null;
}

export interface AgentReviewResumeValue {
  type: "review";
  selected_issue_ids: string[];
  feedback?: string;
  skip?: boolean;
}

export type AgentResumeValue =
  | { answers: string }
  | { selected_proposal: number; feedback?: string }
  | { action: 'confirm'; confirmed_outline: string }
  | { action: 'regenerate'; feedback?: string }
  | AgentBriefResumeValue
  | AgentBlueprintResumeValue
  | AgentReviewResumeValue;

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
      message: string;
    }
  | {
      type: 'done';
      final_content: string;
      insert_mode?: string;
    }
  | {
      type: 'await_input';
      phase: 'clarify' | 'propose' | 'outline' | 'brief' | 'blueprint' | 'review' | string;
      data: AgentAwaitInputData | Record<string, unknown>;
    }
  | {
      type: 'session';
      thread_id: string;
    }
  | {
      type: 'cancelled';
    };
