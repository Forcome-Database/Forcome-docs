import {
  createCreatorAwaitInputEvent,
  createCreatorContentDeltaEvent,
  createCreatorDoneEvent,
  createCreatorErrorEvent,
  serializeCreatorStreamEvent,
} from './creator-stream.events';

describe('creator stream events', () => {
  it('serializes typed content delta events', () => {
    expect(serializeCreatorStreamEvent(createCreatorContentDeltaEvent('hello'))).toBe(
      JSON.stringify({
        type: 'content_delta',
        chunk: 'hello',
      }),
    );
  });

  it('builds outline await_input payloads', () => {
    expect(createCreatorAwaitInputEvent('## Outline')).toEqual({
      type: 'await_input',
      phase: 'outline',
      data: { outline: '## Outline' },
    });
  });

  it('builds typed terminal events', () => {
    expect(createCreatorDoneEvent()).toEqual({ type: 'done' });
    expect(createCreatorErrorEvent('boom')).toEqual({
      type: 'error',
      message: 'boom',
    });
  });
});
