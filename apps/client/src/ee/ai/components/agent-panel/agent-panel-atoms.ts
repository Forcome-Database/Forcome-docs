import { atom } from "jotai";

/**
 * Agent 面板上传的文件列表。
 * 预留：当前 useAgentSession 内部管理文件状态，
 * 未来可用于跨组件共享（如面板切换时保持文件列表）。
 */
export const agentFilesAtom = atom<File[]>([]);

/**
 * 当前对话的 thread_id（由 session SSE 事件设置）。
 * 预留：当前 useAgentSession 内部管理，
 * 未来可用于跨面板持久化会话标识。
 */
export const agentThreadIdAtom = atom<string | null>(null);
