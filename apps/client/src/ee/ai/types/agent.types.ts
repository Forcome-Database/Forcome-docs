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

export interface AgentBriefAwaitInputData {
  type: "brief";
  audience: string;
  goal: string;
  target_length: number;
  length_tolerance: number;
  style: string;
  tone: string;
  structure_strategy: string;
  image_strategy: string;
  constraints: string[];
  [key: string]: unknown;
}

export interface AgentBlueprintAwaitInputData {
  type: "blueprint";
  title: string;
  sections: Array<{
    id: string;
    title: string;
    level: number;
    word_budget: number;
    description: string;
    assets: string[];
    visuals: Array<{ type: string; description: string; source_asset_id?: string | null; position: string }>;
    must_cover: string[];
  }>;
  total_word_budget: number;
  style_guide: string;
  visual_plan_summary: string;
  [key: string]: unknown;
}

export interface AgentReviewAwaitInputData {
  type: "review";
  overall_score: number;
  length_compliance: number;
  asset_reuse_rate: number;
  issues: Array<{
    id: string;
    section_id: string | null;
    severity: string;
    category: string;
    description: string;
    suggestion: string;
    auto_fixable: boolean;
    fixed: boolean;
  }>;
  auto_fixed_count: number;
  user_decision_needed: string[];
  [key: string]: unknown;
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
      phase: 'clarify' | 'propose' | 'outline' | string;
      data: AgentAwaitInputData | Record<string, unknown>;
    }
  | {
      type: 'session';
      thread_id: string;
    }
  | {
      type: 'cancelled';
    };
