export interface AgentStepInfo {
  step: string;
  description: string;
  status: 'running' | 'done' | 'error' | 'pending';
  resultSummary?: string;
}

export interface AgentSSEEvent {
  type: 'step_start' | 'step_done' | 'content' | 'image' | 'tool_call' | 'error' | 'done';
  [key: string]: any;
}
