import type { AgentResumeValue, AgentSSEEvent } from '../types/agent.types';

export interface AgentGenerateParams {
  files: File[];
  prompt: string;
  pageId: string;
  templateId?: string;
  insertMode?: string;
  pageTitle?: string;
  pageContent?: string;
  selectedText?: string;
  selectionRange?: { from: number; to: number } | null;
  history?: { role: string; content: string }[];
}

function createReaderErrorMessage(): string {
  return 'Unable to read agent response stream';
}

export function agentGenerate(
  params: AgentGenerateParams,
  onEvent: (event: AgentSSEEvent) => void,
  onError: (error: string) => void,
  onComplete: () => void,
  onTaskId?: (taskId: string) => void,
): AbortController {
  const controller = new AbortController();

  const formData = new FormData();
  formData.append('prompt', params.prompt);
  formData.append('pageId', params.pageId);
  if (params.templateId) formData.append('templateId', params.templateId);
  if (params.insertMode) formData.append('insertMode', params.insertMode);
  if (params.pageTitle) formData.append('pageTitle', params.pageTitle);
  if (params.pageContent) formData.append('pageContent', params.pageContent);
  if (params.selectedText) formData.append('selectedText', params.selectedText);
  if (params.selectionRange) {
    formData.append('selectionRange', JSON.stringify(params.selectionRange));
  }
  if (params.history) formData.append('history', JSON.stringify(params.history));
  for (const file of params.files) {
    formData.append('files', file);
  }

  fetch('/api/agent/run', {
    method: 'POST',
    body: formData,
    signal: controller.signal,
  })
    .then(async (resp) => {
      if (!resp.ok) {
        onError(`Agent request failed: ${resp.status}`);
        return;
      }

      const taskId = resp.headers.get('X-Task-Id');
      if (taskId) {
        onTaskId?.(taskId);
      }

      const reader = resp.body?.getReader();
      if (!reader) {
        onError(createReaderErrorMessage());
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) {
            continue;
          }

          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            continue;
          }

          try {
            const event: AgentSSEEvent = JSON.parse(data);
            onEvent(event);
          } catch {
            // Ignore parse errors from malformed stream chunks.
          }
        }
      }

      onComplete();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError(err.message || 'Agent request failed');
      }
    });

  return controller;
}

export function resumeAgent(
  threadId: string,
  resumeValue: AgentResumeValue,
  onEvent: (event: AgentSSEEvent) => void,
  onError: (error: string) => void,
  onComplete: () => void,
  onTaskId?: (taskId: string) => void,
): AbortController {
  const controller = new AbortController();

  fetch('/api/agent/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, resumeValue }),
    signal: controller.signal,
  })
    .then(async (resp) => {
      if (!resp.ok) {
        onError(`Agent resume failed: ${resp.status}`);
        return;
      }

      const taskId = resp.headers.get('X-Task-Id');
      if (taskId) {
        onTaskId?.(taskId);
      }

      const reader = resp.body?.getReader();
      if (!reader) {
        onError(createReaderErrorMessage());
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) {
            continue;
          }

          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            continue;
          }

          try {
            const event: AgentSSEEvent = JSON.parse(data);
            onEvent(event);
          } catch {
            // Ignore parse errors from malformed stream chunks.
          }
        }
      }

      onComplete();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError(err.message || 'Agent resume failed');
      }
    });

  return controller;
}

export async function stopAgentTask(taskId: string): Promise<void> {
  const response = await fetch('/api/agent/stop', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ taskId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to stop agent task: ${response.status}`);
  }
}
