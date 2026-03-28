/** V2 SSE 事件类型 — 对应 agent-service event_bridge.py 的输出 */
export type AgentV2Event =
  | { type: "session"; thread_id: string }
  | { type: "tool_call"; tool: string; description: string; args?: Record<string, unknown> }
  | { type: "tool_result"; status: string }
  | { type: "thinking"; content?: string; chunk?: string; phase?: number }
  | { type: "content"; chunk: string }
  | { type: "warning"; issues: string[] }
  | { type: "retrying"; reason: string }
  | { type: "content_clear" }
  /** 最终完成事件。final_content 是后端权威输出（不含中间叙述），
   *  前端用于 "Apply to page"，而非使用流式累积的 content。
   *  output_type 区分 "document"（可写回页面）与 "conversation"（仅展示）。 */
  | { type: "done"; final_content?: string; output_type?: "document" | "conversation" }
  | { type: "error"; message: string }
  | { type: "cancelled" };

/** 时间线项 — 按到达顺序渲染，保持事件的自然交错 */
export type TimelineItem =
  | { kind: "thinking"; content: string }
  | { kind: "tool"; id: string; tool: string; description: string; status: "running" | "done" }
  | { kind: "text"; content: string; isNarration: boolean };

/** 面板消息 */
export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  files?: string[];
  /** 时间线：按到达顺序排列的 thinking / tool / text 项 */
  timeline?: TimelineItem[];
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
  outputType: "document" | "conversation" | null;
  submit: (prompt: string, files?: File[], pageContent?: string) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

/** 发送给 v2 端点的请求体 */
export interface AgentV2RunRequest {
  prompt: string;
  pageId?: string;
  threadId?: string;
  pageContent?: string;
  files?: Array<{ content_b64: string; filename: string; mimetype: string }>;
}
