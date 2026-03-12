export interface AgentStepInfo {
  step: string;
  description: string;
  status: 'running' | 'done' | 'error' | 'pending';
  resultSummary?: string;
}

export interface AgentSSEEvent {
  type: 'step_start' | 'step_done' | 'content' | 'content_clear' | 'image' | 'tool_call' | 'error' | 'done' | 'await_input' | 'session' | 'cancelled';
  [key: string]: any;
}
