export interface StepEvent {
  type: 'step_start' | 'step_done';
  step_name: string;
  description?: string;
  result_summary?: string;
}

export interface ContentEvent {
  type: 'content_delta' | 'content_cleared';
  chunk?: string;
  section_id?: string | null;
}

export interface InteractionEvent {
  type: 'await_user_input';
  phase: 'brief' | 'blueprint' | 'review';
  data: Record<string, unknown>;
}

export interface SectionProgressEvent {
  type: 'section_progress';
  current: number;
  total: number;
  section_title?: string;
}

export interface CompletionEvent {
  type: 'done' | 'error' | 'cancelled';
  final_content?: string;
  error_message?: string;
}

export interface ComplexityEvent {
  type: 'complexity_analyzed';
  level: number;
  reasoning?: string;
}

export type SSEEventV2 =
  | StepEvent
  | ContentEvent
  | InteractionEvent
  | SectionProgressEvent
  | CompletionEvent
  | ComplexityEvent;
