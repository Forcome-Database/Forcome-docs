import type { SelectionSnapshot } from "./ai-creator.types";
import type {
  AgentAwaitInputData,
  AgentBlockState,
  AgentSessionRunState,
} from "../../types/agent.types";

export type AiCreateSessionMode = "standard" | "agent";
export type AiCreateSessionStatus =
  | "idle"
  | "running"
  | "awaiting_input"
  | "blocked"
  | "completed"
  | "error"
  | "cancelled";
export type AiCreateInsertMode = "create" | "append" | "overwrite" | "replace";
export type AiCreateAwaitInputPhase = "brief" | "blueprint" | "review";

export interface AiCreateAwaitInputState {
  phase: AiCreateAwaitInputPhase;
  data: AgentAwaitInputData;
}

export interface AiCreateSessionState {
  status: AiCreateSessionStatus;
  mode: AiCreateSessionMode | null;
  insertMode: AiCreateInsertMode | null;
  threadId: string | null;
  taskId: string | null;
  accumulatedContent: string;
  mdBuffer: string;
  startedAt: number | null;
  selectionSnapshot: SelectionSnapshot | null;
  awaitInput: AiCreateAwaitInputState | null;
  block: AgentBlockState | null;
  error: string | null;
}

export type AiCreateSessionAction =
  | { type: "reset" }
  | {
      type: "run_started";
      mode: AiCreateSessionMode;
      insertMode: AiCreateInsertMode;
      selectionSnapshot: SelectionSnapshot | null;
      startedAt: number;
      threadId?: string | null;
    }
  | { type: "session_received"; threadId: string }
  | { type: "task_received"; taskId: string | null }
  | { type: "content_delta"; chunk: string }
  | { type: "content_cleared" }
  | { type: "buffer_updated"; buffer: string }
  | { type: "await_input"; phase: AiCreateAwaitInputPhase; data: AgentAwaitInputData }
  | { type: "blocked"; block: AgentBlockState }
  | {
      type: "hydrate";
      threadId: string;
      taskId: string | null;
      status: AgentSessionRunState;
      awaitInput: AiCreateAwaitInputState | null;
      block: AgentBlockState | null;
      draftMarkdown: string;
    }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "cancelled" };
