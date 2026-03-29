import { Injectable, Logger } from '@nestjs/common';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import * as http from 'http';

export interface WebEvidence {
  url: string;
  title?: string;
  snippet?: string;
  content?: string;
  origin: 'web';
}

@Injectable()
export class WebExplorerService {
  private readonly logger = new Logger(WebExplorerService.name);

  constructor(private readonly environmentService: EnvironmentService) {}

  /**
   * Search the web for evidence to answer a question.
   * Calls the agent-service's /agent/web-search endpoint.
   */
  async explore(query: string): Promise<WebEvidence[]> {
    const agentPort = process.env.AGENT_PORT || '8100';
    const agentUrl = process.env.AGENT_SERVICE_URL || `http://localhost:${agentPort}`;
    const secret = process.env.AGENT_INTERNAL_SECRET || '';

    try {
      const response = await this.httpPost(`${agentUrl}/agent/web-search`, {
        query: query.slice(0, 500),
        max_results: 3,
        scrape_top: 1,
      }, secret);

      if (response.status !== 'success' || !Array.isArray(response.evidence)) {
        return [];
      }

      return response.evidence
        .filter((e: any) => e.url)
        .map((e: any): WebEvidence => ({
          url: e.url,
          title: e.title || e.snippet?.slice(0, 80) || e.url,
          snippet: e.snippet || '',
          content: e.content || e.snippet || '',
          origin: 'web',
        }));
    } catch (err: any) {
      this.logger.warn(`Web exploration failed (non-blocking): ${err?.message}`);
      return [];
    }
  }

  private httpPost(url: string, body: any, secret: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const parsed = new URL(url);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'X-Internal-Secret': secret,
          },
          timeout: 20000,
        },
        (res) => {
          let chunks = '';
          res.on('data', (chunk) => (chunks += chunk));
          res.on('end', () => {
            try { resolve(JSON.parse(chunks)); }
            catch { reject(new Error('Invalid JSON from agent-service')); }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Agent service timeout')); });
      req.write(data);
      req.end();
    });
  }
}
