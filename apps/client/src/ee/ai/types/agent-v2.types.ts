/** V2 SSE 事件类型 — 对应 agent-service event_bridge.py 的输出 */
export type AgentV2Event =
  | { type: "session"; thread_id: string }
  | { type: "tool_call"; tool: string; description: string; args?: Record<string, unknown> }
  | { type: "tool_result"; status: string }
  | { type: "thinking"; content: string }
  | { type: "content"; chunk: string }
  | { type: "warning"; issues: string[] }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "cancelled" };

/** 工具调用步骤（前端展示用） */
export interface ToolStep {
  id: string;
  tool: string;
  description: string;
  status: "running" | "done";
}

/** 面板消息 */
export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  files?: string[];
  toolSteps?: ToolStep[];
  streaming?: boolean;
  warnings?: string[];
}

/** 会话状态 */
export type AgentSessionStatus =
  | "idle"
  | "streaming"
  | "thinking"
  | "done"
  | "error"
  | "cancelled";

/** useAgentSession Hook 的返回类型 */
export interface AgentSessionAPI {
  messages: AgentMessage[];
  status: AgentSessionStatus;
  threadId: string | null;
  lastOutput: string | null;
  submit: (prompt: string, files?: File[]) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

/** 发送给 v2 端点的请求体（camelCase — NestJS Gateway 负责转为 snake_case） */
export interface AgentV2RunRequest {
  prompt: string;
  pageId?: string;
  threadId?: string;
  files?: Array<{ content_b64: string; filename: string; mimetype: string }>;
}
