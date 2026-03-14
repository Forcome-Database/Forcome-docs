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

export type AgentAwaitInputData =
  | AgentClarifyAwaitInputData
  | AgentProposeAwaitInputData
  | AgentOutlineAwaitInputData;

export type AgentResumeValue =
  | { answers: string }
  | { selected_proposal: number; feedback?: string }
  | { action: 'confirm'; confirmed_outline: string }
  | { action: 'regenerate'; feedback?: string };

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
