import type {
  AgentAwaitInputData,
  AgentBlockState,
  AgentResumeValue,
  AgentSessionSnapshot,
  AgentSessionRunState,
  AgentSSEEvent,
} from '../types/agent.types';

export interface AgentGenerateParams {
  files?: File[];
  prompt: string;
  pageId: string;
  templateId?: string;
  insertMode?: string;
  pageTitle?: string;
  pageContent?: string;
  selectedText?: string;
  history?: { role: string; content: string }[];
  intentRoute?: "selection_edit" | "document_transform" | "document_create";
  threadId?: string;
  conversationHistory?: { role: string; content: string }[];
}

function createReaderErrorMessage(): string {
  return 'Unable to read agent response stream';
}

function normalizeSessionRunState(value: unknown): AgentSessionRunState | null {
  switch (value) {
    case 'idle':
    case 'running':
    case 'awaiting_input':
    case 'blocked':
    case 'completed':
    case 'error':
    case 'cancelled':
      return value;
    default:
      return null;
  }
}

function normalizeSessionAwaitInput(
  value: unknown,
): AgentSessionSnapshot['awaitInput'] {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const phase = (value as { phase?: unknown }).phase;
  const data = (value as { data?: unknown }).data;
  if (
    (phase !== 'brief' && phase !== 'blueprint' && phase !== 'review') ||
    !data ||
    typeof data !== 'object' ||
    (data as { type?: unknown }).type !== phase
  ) {
    return null;
  }

  return {
    phase,
    data: data as AgentAwaitInputData,
  };
}

function normalizeSessionBlock(value: unknown): AgentBlockState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const message = typeof (value as { message?: unknown }).message === 'string'
    ? (value as { message: string }).message
    : null;
  if (!message) {
    return null;
  }

  return {
    kind:
      typeof (value as { kind?: unknown }).kind === 'string'
        ? (value as { kind: string }).kind
        : 'general',
    message,
    requiredAction:
      typeof (value as { required_action?: unknown }).required_action === 'string'
        ? (value as { required_action: string }).required_action
        : '',
    allowedResolutions: Array.isArray(
      (value as { allowed_resolutions?: unknown }).allowed_resolutions,
    )
      ? (value as { allowed_resolutions: string[] }).allowed_resolutions
      : [],
  };
}

function normalizeSessionDraftSections(
  value: unknown,
): AgentSessionSnapshot['draftSections'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const sectionId =
      typeof (item as { section_id?: unknown }).section_id === 'string'
        ? (item as { section_id: string }).section_id
        : null;
    const nodeId =
      typeof (item as { node_id?: unknown }).node_id === 'string'
        ? (item as { node_id: string }).node_id
        : sectionId
          ? `section:${sectionId}`
          : null;
    const title =
      typeof (item as { title?: unknown }).title === 'string'
        ? (item as { title: string }).title
        : null;
    const level =
      typeof (item as { level?: unknown }).level === 'number'
        ? (item as { level: number }).level
        : 2;
    const content =
      typeof (item as { content?: unknown }).content === 'string'
        ? (item as { content: string }).content
        : null;

    if (!nodeId || !sectionId || !title || content === null) {
      return [];
    }

    return [{ nodeId, sectionId, title, level, content }];
  });
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
  for (const file of params.files ?? []) {
    formData.append('files', file);
  }
  formData.append('prompt', params.prompt);
  formData.append('pageId', params.pageId);
  if (params.templateId) formData.append('templateId', params.templateId);
  if (params.insertMode) formData.append('insertMode', params.insertMode);
  if (params.pageTitle) formData.append('pageTitle', params.pageTitle);
  if (params.pageContent) formData.append('pageContent', params.pageContent);
  if (params.selectedText) formData.append('selectedText', params.selectedText);
  if (params.intentRoute) formData.append('intentRoute', params.intentRoute);
  if (params.threadId) formData.append('threadId', params.threadId);
  const history = params.conversationHistory ?? params.history ?? [];
  if (history.length > 0) {
    formData.append('conversationHistory', JSON.stringify(history));
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
  sessionId: string,
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
    body: JSON.stringify({ sessionId, resumeValue }),
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

export async function getAgentSession(
  sessionId: string,
): Promise<AgentSessionSnapshot | null> {
  const response = await fetch(`/api/agent/session/${sessionId}`);
  if (!response.ok) {
    throw new Error(`Failed to load agent session: ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.status !== 'ok' || !payload.session || typeof payload.session !== 'object') {
    return null;
  }

  const session = payload.session as Record<string, unknown>;
  const status = normalizeSessionRunState(session.run_state);
  if (!status) {
    return null;
  }

  const normalizedSessionId =
    typeof session.session_id === 'string' ? session.session_id : sessionId;
  const threadId =
    typeof session.thread_id === 'string' ? session.thread_id : normalizedSessionId;
  const draftMarkdown =
    typeof session.draft_markdown === 'string'
      ? session.draft_markdown
      : typeof session.final_content === 'string'
        ? session.final_content
        : '';

  return {
    sessionId: normalizedSessionId,
    threadId,
    status,
    awaitInput:
      status === 'awaiting_input'
        ? normalizeSessionAwaitInput(session.pending_decision)
        : null,
    block: status === 'blocked' ? normalizeSessionBlock(session.blocked) : null,
    draftMarkdown,
    draftSections: normalizeSessionDraftSections(session.draft_sections),
  };
}
