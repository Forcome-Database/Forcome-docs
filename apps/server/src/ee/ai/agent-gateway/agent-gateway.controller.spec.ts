import { PassThrough } from 'stream';
import * as http from 'http';
import { AgentGatewayController } from './agent-gateway.controller';

function buildLegacyRunPayload(payload: Record<string, any>) {
  return {
    user_message: payload.prompt || '',
    thread_id: payload.threadId || undefined,
    workspace_id: payload.workspaceId || '',
    page_id: payload.pageId || undefined,
    page_title: payload.pageTitle || undefined,
    page_content: payload.pageContent || undefined,
    selected_text: payload.selectedText || undefined,
    intent_route: payload.intentRoute || 'document_create',
    insert_mode: payload.insertMode || 'create',
    files: payload.files || [],
    template_id: payload.templateId || undefined,
    system_prompt: payload.systemPrompt || undefined,
    template_prompt: payload.templatePrompt || undefined,
    conversation_history: Array.isArray(payload.conversationHistory)
      ? payload.conversationHistory
      : [],
    ...(payload.operation ? { operation: payload.operation } : {}),
    ...(payload.documentTask ? { document_task: payload.documentTask } : {}),
    ...(payload.payload ? { payload: payload.payload } : {}),
  };
}

describe('AgentGatewayController', () => {
  it('forwards multipart fields and files to the agent runtime', async () => {
    const agentGatewayService = {
      stopAgent: jest.fn(),
      getTools: jest.fn(),
      buildLegacyRunPayload: jest.fn((payload) => buildLegacyRunPayload(payload)),
    };
    const environmentService = {
      getAgentServiceUrl: jest.fn(() => 'http://agent-service.internal'),
      getAgentInternalSecret: jest.fn(() => 'secret'),
    };
    const aiTemplateService = {
      getSystemPrompt: jest.fn(async () => null),
      getTemplatePrompt: jest.fn(async () => null),
    };

    const controller = new AgentGatewayController(
      agentGatewayService as any,
      environmentService as any,
      aiTemplateService as any,
    );

    const fieldParts = [
      { type: 'field', fieldname: 'prompt', value: 'Use the uploaded file to rewrite this page.' },
      { type: 'field', fieldname: 'pageId', value: 'page-123' },
      { type: 'field', fieldname: 'pageTitle', value: 'Draft page' },
      { type: 'field', fieldname: 'pageContent', value: 'Existing content' },
      { type: 'field', fieldname: 'operation', value: 'request_diff' },
      {
        type: 'field',
        fieldname: 'documentTask',
        value: JSON.stringify({
          task_id: 'task-1',
          task_type: 'document_transform',
          source_scope: 'uploaded_document',
          mode: 'strict_preservation',
        }),
      },
      {
        type: 'file',
        filename: 'notes.md',
        mimetype: 'text/markdown',
        toBuffer: jest.fn(async () => Buffer.from('# Notes')),
      },
    ];

    const req = {
      headers: {
        'content-type': 'multipart/form-data; boundary=test-boundary',
      },
      parts: async function* parts() {
        for (const part of fieldParts) {
          yield part;
        }
      },
    };

    const writeHead = jest.fn();
    const write = jest.fn();
    const end = jest.fn();
    const hijack = jest.fn();
    const res = {
      hijack,
      raw: {
        headersSent: false,
        writeHead,
        write,
        end,
        flushHeaders: jest.fn(),
      },
    };

    let capturedBody = '';
    let releaseStream: (() => void) | null = null;

    jest.spyOn(http, 'request').mockImplementation((options: any, callback: any) => {
      const proxyRes = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      proxyRes.statusCode = 200;
      proxyRes.headers = { 'x-task-id': 'task-1' };

      const proxyReq = {
        on: jest.fn().mockReturnThis(),
        write: jest.fn((chunk: string) => {
          capturedBody += chunk;
        }),
        end: jest.fn(() => {
          callback(proxyRes);
          releaseStream = () => {
            proxyRes.write('data: {"type":"session"}\n\n');
            proxyRes.end();
          };
        }),
      };

      return proxyReq as any;
    });

    let settled = false;
    const runPromise = controller
      .runAgent(
      req as any,
      res as any,
      { id: 'user-1' },
      { id: 'workspace-1', settings: { ai: {} } },
      )
      .then(() => {
        settled = true;
      });

    await new Promise((resolve) => setImmediate(resolve));

    expect(hijack).toHaveBeenCalled();
    expect(settled).toBe(false);
    releaseStream?.();

    const agentBody = JSON.parse(capturedBody);
    expect(agentBody).toMatchObject({
      user_message: 'Use the uploaded file to rewrite this page.',
      page_id: 'page-123',
      page_title: 'Draft page',
      page_content: 'Existing content',
      operation: 'request_diff',
      document_task: {
        task_id: 'task-1',
        task_type: 'document_transform',
        source_scope: 'uploaded_document',
        mode: 'strict_preservation',
      },
      files: [
        {
          filename: 'notes.md',
          mimetype: 'text/markdown',
          content_b64: Buffer.from('# Notes').toString('base64'),
        },
      ],
    });
    expect(writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'text/event-stream',
        'X-Task-Id': 'task-1',
      }),
    );

    await runPromise;
  });

  it('falls back to the JSON body when Fastify exposes multipart helpers on a non-multipart agent run request', async () => {
    const agentGatewayService = {
      stopAgent: jest.fn(),
      getTools: jest.fn(),
      buildLegacyRunPayload: jest.fn((payload) => buildLegacyRunPayload(payload)),
    };
    const environmentService = {
      getAgentServiceUrl: jest.fn(() => 'http://agent-service.internal'),
      getAgentInternalSecret: jest.fn(() => 'secret'),
    };
    const aiTemplateService = {
      getSystemPrompt: jest.fn(async () => null),
      getTemplatePrompt: jest.fn(async () => null),
    };

    const controller = new AgentGatewayController(
      agentGatewayService as any,
      environmentService as any,
      aiTemplateService as any,
    );

    const req = {
      body: {
        prompt: 'Optimize the current page',
        pageId: 'page-456',
        intentRoute: 'document_transform',
        threadId: 'task-2',
        documentTask: {
          task_id: 'task-2',
          task_type: 'document_transform',
          source_scope: 'current_page',
          mode: 'strict_preservation',
        },
      },
      headers: {
        'content-type': 'application/json',
      },
      parts: () => {
        throw new Error('parts() should not be called for JSON requests');
      },
    };

    const writeHead = jest.fn();
    const write = jest.fn();
    const end = jest.fn();
    const hijack = jest.fn();
    const res = {
      hijack,
      raw: {
        headersSent: false,
        writeHead,
        write,
        end,
        flushHeaders: jest.fn(),
      },
    };

    let capturedBody = '';
    let releaseStream: (() => void) | null = null;

    jest.spyOn(http, 'request').mockImplementation((options: any, callback: any) => {
      const proxyRes = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      proxyRes.statusCode = 200;
      proxyRes.headers = { 'x-task-id': 'task-2' };

      const proxyReq = {
        on: jest.fn().mockReturnThis(),
        write: jest.fn((chunk: string) => {
          capturedBody += chunk;
        }),
        end: jest.fn(() => {
          callback(proxyRes);
          releaseStream = () => {
            proxyRes.write('data: {"type":"session"}\n\n');
            proxyRes.end();
          };
        }),
      };

      return proxyReq as any;
    });

    let settled = false;
    const runPromise = controller
      .runAgent(
        req as any,
        res as any,
        { id: 'user-1' },
        { id: 'workspace-1', settings: { ai: {} } },
      )
      .then(() => {
        settled = true;
      });

    await new Promise((resolve) => setImmediate(resolve));

    expect(hijack).toHaveBeenCalled();
    expect(settled).toBe(false);
    releaseStream?.();

    const agentBody = JSON.parse(capturedBody);
    expect(agentBody).toMatchObject({
      user_message: 'Optimize the current page',
      page_id: 'page-456',
      thread_id: 'task-2',
      intent_route: 'document_transform',
      document_task: {
        task_id: 'task-2',
        task_type: 'document_transform',
        source_scope: 'current_page',
        mode: 'strict_preservation',
      },
      files: [],
    });

    await runPromise;
  });

  it('proxies session snapshot requests to the agent runtime', async () => {
    const agentGatewayService = {
      stopAgent: jest.fn(),
      getTools: jest.fn(),
      buildLegacyRunPayload: jest.fn((payload) => buildLegacyRunPayload(payload)),
    };
    const environmentService = {
      getAgentServiceUrl: jest.fn(() => 'http://agent-service.internal'),
      getAgentInternalSecret: jest.fn(() => 'secret'),
    };
    const aiTemplateService = {
      getSystemPrompt: jest.fn(async () => null),
      getTemplatePrompt: jest.fn(async () => null),
    };

    const controller = new AgentGatewayController(
      agentGatewayService as any,
      environmentService as any,
      aiTemplateService as any,
    );

    const send = jest.fn();
    const res = {
      status: jest.fn().mockReturnThis(),
      send,
    };

    let capturedOptions: any;

    jest.spyOn(http, 'request').mockImplementation((options: any, callback: any) => {
      capturedOptions = options;
      const proxyRes = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      proxyRes.statusCode = 200;
      proxyRes.headers = { 'content-type': 'application/json' };

      const proxyReq = {
        on: jest.fn().mockReturnThis(),
        write: jest.fn(),
        end: jest.fn(() => {
          callback(proxyRes);
          proxyRes.write(
            JSON.stringify({
              status: 'ok',
              session: { session_id: 'session-1', run_state: 'awaiting_input' },
            }),
          );
          proxyRes.end();
        }),
      };

      return proxyReq as any;
    });

    await controller.getSessionSnapshot('session-1', res as any);

    expect(capturedOptions.path).toBe('/agent/session/session-1');
    expect(send).toHaveBeenCalledWith({
      status: 'ok',
      session: { session_id: 'session-1', run_state: 'awaiting_input' },
    });
  });

  it('proxies typed resume commands using sessionId as the public identifier', async () => {
    const agentGatewayService = {
      stopAgent: jest.fn(),
      getTools: jest.fn(),
      buildLegacyRunPayload: jest.fn((payload) => buildLegacyRunPayload(payload)),
    };
    const environmentService = {
      getAgentServiceUrl: jest.fn(() => 'http://agent-service.internal'),
      getAgentInternalSecret: jest.fn(() => 'secret'),
    };
    const aiTemplateService = {
      getSystemPrompt: jest.fn(async () => null),
      getTemplatePrompt: jest.fn(async () => null),
    };

    const controller = new AgentGatewayController(
      agentGatewayService as any,
      environmentService as any,
      aiTemplateService as any,
    );

    const writeHead = jest.fn();
    const write = jest.fn();
    const end = jest.fn();
    const hijack = jest.fn();
    const res = {
      hijack,
      raw: {
        headersSent: false,
        writeHead,
        write,
        end,
        flushHeaders: jest.fn(),
      },
    };

    let capturedBody = '';
    let releaseStream: (() => void) | null = null;

    jest.spyOn(http, 'request').mockImplementation((options: any, callback: any) => {
      const proxyRes = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      proxyRes.statusCode = 200;
      proxyRes.headers = { 'x-task-id': 'task-2' };

      const proxyReq = {
        on: jest.fn().mockReturnThis(),
        write: jest.fn((chunk: string) => {
          capturedBody += chunk;
        }),
        end: jest.fn(() => {
          callback(proxyRes);
          releaseStream = () => {
            proxyRes.write('data: {"type":"session"}\n\n');
            proxyRes.end();
          };
        }),
      };

      return proxyReq as any;
    });

    let settled = false;
    const resumePromise = controller
      .resumeAgent(
      {
        sessionId: 'session-1',
        resumeValue: {
          type: 'confirm_brief',
          brief: { audience: 'engineers' },
        },
      },
      res as any,
      )
      .then(() => {
        settled = true;
      });

    await Promise.resolve();

    expect(hijack).toHaveBeenCalled();
    expect(settled).toBe(false);
    releaseStream?.();
    expect(JSON.parse(capturedBody)).toEqual({
      thread_id: 'session-1',
      resume_value: {
        type: 'confirm_brief',
        brief: { audience: 'engineers' },
      },
    });
    expect(writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'text/event-stream',
        'X-Task-Id': 'task-2',
      }),
    );

    await resumePromise;
  });

  it('preserves document-task compatibility fields when /agent/run receives a JSON body', async () => {
    const agentGatewayService = {
      stopAgent: jest.fn(),
      getTools: jest.fn(),
      buildLegacyRunPayload: jest.fn((payload) => buildLegacyRunPayload(payload)),
    };
    const environmentService = {
      getAgentServiceUrl: jest.fn(() => 'http://agent-service.internal'),
      getAgentInternalSecret: jest.fn(() => 'secret'),
    };
    const aiTemplateService = {
      getSystemPrompt: jest.fn(async () => null),
      getTemplatePrompt: jest.fn(async () => null),
    };

    const controller = new AgentGatewayController(
      agentGatewayService as any,
      environmentService as any,
      aiTemplateService as any,
    );

    let capturedBody = '';
    let releaseStream: (() => void) | null = null;

    jest.spyOn(http, 'request').mockImplementation((options: any, callback: any) => {
      const proxyRes = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      proxyRes.statusCode = 200;
      proxyRes.headers = { 'x-task-id': 'task-json-1' };

      const proxyReq = {
        on: jest.fn().mockReturnThis(),
        write: jest.fn((chunk: string) => {
          capturedBody += chunk;
        }),
        end: jest.fn(() => {
          callback(proxyRes);
          releaseStream = () => {
            proxyRes.write('data: {"type":"session"}\n\n');
            proxyRes.end();
          };
        }),
      };

      return proxyReq as any;
    });

    const res = {
      hijack: jest.fn(),
      raw: {
        headersSent: false,
        writeHead: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        flushHeaders: jest.fn(),
      },
    };

    const runPromise = controller.runAgent(
      {
        body: {
          prompt: 'Plan a preservation-first diff',
          pageId: 'page-77',
          operation: 'request_plan',
          documentTask: {
            task_id: 'task-77',
            task_type: 'document_transform',
            source_scope: 'current_page',
            mode: 'strict_preservation',
          },
        },
      } as any,
      res as any,
      { id: 'user-1' },
      { id: 'workspace-1', settings: { ai: {} } },
    );

    await Promise.resolve();
    releaseStream?.();
    await runPromise;

    expect(JSON.parse(capturedBody)).toMatchObject({
      operation: 'request_plan',
      document_task: {
        task_id: 'task-77',
        source_scope: 'current_page',
      },
    });
  });

  it('passes through prebuilt legacy JSON payloads without rebuilding them from form-style fields', async () => {
    const agentGatewayService = {
      stopAgent: jest.fn(),
      getTools: jest.fn(),
      buildLegacyRunPayload: jest.fn((payload) => buildLegacyRunPayload(payload)),
    };
    const environmentService = {
      getAgentServiceUrl: jest.fn(() => 'http://agent-service.internal'),
      getAgentInternalSecret: jest.fn(() => 'secret'),
    };
    const aiTemplateService = {
      getSystemPrompt: jest.fn(async () => null),
      getTemplatePrompt: jest.fn(async () => null),
    };

    const controller = new AgentGatewayController(
      agentGatewayService as any,
      environmentService as any,
      aiTemplateService as any,
    );

    let capturedBody = '';
    let releaseStream: (() => void) | null = null;

    jest.spyOn(http, 'request').mockImplementation((options: any, callback: any) => {
      const proxyRes = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      proxyRes.statusCode = 200;
      proxyRes.headers = { 'x-task-id': 'task-legacy-1' };

      const proxyReq = {
        on: jest.fn().mockReturnThis(),
        write: jest.fn((chunk: string) => {
          capturedBody += chunk;
        }),
        end: jest.fn(() => {
          callback(proxyRes);
          releaseStream = () => {
            proxyRes.write('data: {"type":"session"}\n\n');
            proxyRes.end();
          };
        }),
      };

      return proxyReq as any;
    });

    const res = {
      hijack: jest.fn(),
      raw: {
        headersSent: false,
        writeHead: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        flushHeaders: jest.fn(),
      },
    };

    const legacyPayload = {
      user_message: 'Optimize the current page for clarity.',
      thread_id: 'task-legacy-1',
      workspace_id: 'workspace-1',
      page_id: 'page-legacy-1',
      page_title: 'Legacy task page',
      page_content: 'Original content',
      intent_route: 'document_transform',
      insert_mode: 'create',
      files: [],
      conversation_history: [],
      operation: 'create_task',
      document_task: {
        task_id: 'task-legacy-1',
        task_type: 'document_transform',
        source_scope: 'current_page',
        mode: 'strict_preservation',
      },
    };

    const runPromise = controller.runAgent(
      {
        body: legacyPayload,
        headers: {
          'content-type': 'application/json',
        },
      } as any,
      res as any,
      { id: 'user-1' },
      { id: 'workspace-1', settings: { ai: {} } },
    );

    await Promise.resolve();
    releaseStream?.();
    await runPromise;

    expect(agentGatewayService.buildLegacyRunPayload).not.toHaveBeenCalled();
    expect(JSON.parse(capturedBody)).toEqual(legacyPayload);
  });
});
