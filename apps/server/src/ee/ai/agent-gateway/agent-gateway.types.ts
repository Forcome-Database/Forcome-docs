export interface AgentProposalOption {
  title: string;
  description: string;
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
