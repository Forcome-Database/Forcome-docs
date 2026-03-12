export interface CreatorContentDeltaEvent {
  type: 'content_delta';
  chunk: string;
}

export interface CreatorAwaitInputEvent {
  type: 'await_input';
  phase: 'outline';
  data: { outline: string };
}

export interface CreatorDoneEvent {
  type: 'done';
}

export interface CreatorErrorEvent {
  type: 'error';
  message: string;
}

export type CreatorStreamEvent =
  | CreatorContentDeltaEvent
  | CreatorAwaitInputEvent
  | CreatorDoneEvent
  | CreatorErrorEvent;

export function createCreatorContentDeltaEvent(chunk: string): CreatorContentDeltaEvent {
  return {
    type: 'content_delta',
    chunk,
  };
}

export function createCreatorAwaitInputEvent(outline: string): CreatorAwaitInputEvent {
  return {
    type: 'await_input',
    phase: 'outline',
    data: { outline },
  };
}

export function createCreatorDoneEvent(): CreatorDoneEvent {
  return { type: 'done' };
}

export function createCreatorErrorEvent(message: string): CreatorErrorEvent {
  return {
    type: 'error',
    message,
  };
}

export function serializeCreatorStreamEvent(event: CreatorStreamEvent): string {
  return JSON.stringify(event);
}
