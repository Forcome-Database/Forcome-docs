import { PassThrough } from 'stream';
import * as http from 'http';
import { AgentGatewayController } from './agent-gateway.controller';

describe('AgentGatewayController', () => {
  it('forwards multipart fields and files to the agent runtime', async () => {
    const agentGatewayService = {
      stopAgent: jest.fn(),
      getTools: jest.fn(),
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
      {
        type: 'file',
        filename: 'notes.md',
        mimetype: 'text/markdown',
        toBuffer: jest.fn(async () => Buffer.from('# Notes')),
      },
    ];

    const req = {
      parts: async function* parts() {
        for (const part of fieldParts) {
          yield part;
        }
      },
    };

    const writeHead = jest.fn();
    const setHeader = jest.fn();
    const write = jest.fn();
    const end = jest.fn();
    const res = {
      raw: {
        headersSent: false,
        writeHead,
        setHeader,
        write,
        end,
      },
    };

    let capturedBody = '';

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
          proxyRes.end();
        }),
      };

      return proxyReq as any;
    });

    await controller.runAgent(
      req as any,
      res as any,
      { id: 'user-1' },
      { id: 'workspace-1', settings: { ai: {} } },
    );

    const agentBody = JSON.parse(capturedBody);

    expect(agentBody).toMatchObject({
      user_message: 'Use the uploaded file to rewrite this page.',
      page_id: 'page-123',
      page_title: 'Draft page',
      page_content: 'Existing content',
      files: [
        {
          filename: 'notes.md',
          mimetype: 'text/markdown',
          content_b64: Buffer.from('# Notes').toString('base64'),
        },
      ],
    });
  });

  it('proxies session snapshot requests to the agent runtime', async () => {
    const agentGatewayService = {
      stopAgent: jest.fn(),
      getTools: jest.fn(),
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
    const setHeader = jest.fn();
    const write = jest.fn();
    const end = jest.fn();
    const res = {
      raw: {
        headersSent: false,
        writeHead,
        setHeader,
        write,
        end,
      },
    };

    let capturedBody = '';

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
          proxyRes.end();
        }),
      };

      return proxyReq as any;
    });

    await controller.resumeAgent(
      {
        sessionId: 'session-1',
        resumeValue: {
          type: 'confirm_brief',
          brief: { audience: 'engineers' },
        },
      },
      res as any,
    );

    expect(JSON.parse(capturedBody)).toEqual({
      thread_id: 'session-1',
      resume_value: {
        type: 'confirm_brief',
        brief: { audience: 'engineers' },
      },
    });
  });
});
