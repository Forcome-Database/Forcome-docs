import { useCallback, useRef } from 'react';
import { useAtom } from 'jotai';
import { agentStepsAtom } from '../components/ai-creator/ai-creator-atoms';
import { agentGenerate, resumeAgent } from '../services/agent-service';
import { AgentSSEEvent, AgentStepInfo } from '../types/agent.types';

export function useAgent(pageId: string) {
  const [allSteps, setAllSteps] = useAtom(agentStepsAtom);
  const abortRef = useRef<AbortController | null>(null);

  const steps = allSteps[pageId] || [];

  const run = useCallback(
    (params: Parameters<typeof agentGenerate>[0], callbacks: {
      onContent: (chunk: string) => void;
      onDone: (finalContent: string, insertMode: string) => void;
      onError: (msg: string) => void;
      onAwaitInput?: (phase: string, data: any) => void;
      onSession?: (threadId: string) => void;
    }) => {
      setAllSteps((prev) => ({ ...prev, [pageId]: [] }));

      const updateStep = (step: string, update: Partial<AgentStepInfo>) => {
        setAllSteps((prev) => {
          const current = [...(prev[pageId] || [])];
          const idx = current.findIndex((s) => s.step === step && s.status !== 'done');
          if (idx >= 0) {
            current[idx] = { ...current[idx], ...update };
          } else {
            current.push({ step, description: '', status: 'pending', ...update } as AgentStepInfo);
          }
          return { ...prev, [pageId]: current };
        });
      };

      const controller = agentGenerate(
        params,
        (event: AgentSSEEvent) => {
          switch (event.type) {
            case 'step_start':
              updateStep(event.step, { description: event.description, status: 'running' });
              break;
            case 'step_done':
              updateStep(event.step, { status: 'done', resultSummary: event.result_summary });
              break;
            case 'content':
              callbacks.onContent(event.chunk);
              break;
            case 'image':
              callbacks.onContent(`\n![${event.alt}](${event.url})\n`);
              break;
            case 'await_input':
              callbacks.onAwaitInput?.(event.phase, event.data);
              break;
            case 'session':
              callbacks.onSession?.(event.thread_id);
              break;
            case 'error':
              callbacks.onError(event.message);
              break;
            case 'done':
              callbacks.onDone(event.final_content, event.insert_mode);
              break;
          }
        },
        callbacks.onError,
        () => {},
      );

      abortRef.current = controller;
    },
    [pageId, setAllSteps],
  );

  const updateStep = useCallback((step: string, update: Partial<AgentStepInfo>) => {
    setAllSteps((prev) => {
      const current = [...(prev[pageId] || [])];
      const idx = current.findIndex((s) => s.step === step && s.status !== 'done');
      if (idx >= 0) {
        current[idx] = { ...current[idx], ...update };
      } else {
        current.push({ step, description: '', status: 'pending', ...update } as AgentStepInfo);
      }
      return { ...prev, [pageId]: current };
    });
  }, [pageId, setAllSteps]);

  const resume = useCallback((threadId: string, resumeValue: Record<string, any>, callbacks: {
    onContent: (chunk: string) => void;
    onDone: (finalContent: string, insertMode: string) => void;
    onError: (error: string) => void;
    onAwaitInput?: (phase: string, data: any) => void;
    onSession?: (threadId: string) => void;
  }) => {
    const controller = resumeAgent(
      threadId,
      resumeValue,
      (event) => {
        switch (event.type) {
          case 'step_start':
            updateStep(event.step, { description: event.description, status: 'running' });
            break;
          case 'step_done':
            updateStep(event.step, { status: 'done', resultSummary: event.result_summary });
            break;
          case 'content':
            callbacks.onContent(event.chunk);
            break;
          case 'image':
            callbacks.onContent(`\n![${event.alt}](${event.url})\n`);
            break;
          case 'await_input':
            callbacks.onAwaitInput?.(event.phase, event.data);
            break;
          case 'session':
            callbacks.onSession?.(event.thread_id);
            break;
          case 'error':
            callbacks.onError(event.message);
            break;
          case 'done':
            callbacks.onDone(event.final_content, event.insert_mode);
            break;
        }
      },
      callbacks.onError,
      () => {},
    );
    abortRef.current = controller;
  }, [updateStep]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return { steps, run, stop, resume };
}
