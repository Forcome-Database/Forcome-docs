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
});
