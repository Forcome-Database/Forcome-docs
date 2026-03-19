export interface AgentProposalOption {
  title: string;
  description: string;
}

export type AgentAwaitInputData =
  | { type: 'brief'; brief: Record<string, unknown>; asset_summary?: Record<string, unknown> }
  | { type: 'blueprint'; blueprint: Record<string, unknown> }
  | { type: 'review'; report: Record<string, unknown> };

export type AgentResumeValue =
  | { type: 'confirm_brief'; brief: Record<string, unknown> }
  | { type: 'confirm_blueprint'; blueprint: Record<string, unknown> | null }
  | { type: 'apply_blueprint_patch'; blueprint: Record<string, unknown> | null; feedback?: string }
  | { type: 'fix_selected_issues'; selected_issue_ids: string[]; feedback?: string }
  | { type: 'accept_review'; feedback?: string }
  | { type: 'resolve_block'; resolution: string; context?: Record<string, unknown> }
  | { type: 'skip_issue'; issue_id: string; feedback?: string };
