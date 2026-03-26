import { atom } from "jotai";

/** Agent 面板上传的文件列表 */
export const agentFilesAtom = atom<File[]>([]);

/** 当前对话的 thread_id（由 session SSE 事件设置） */
export const agentThreadIdAtom = atom<string | null>(null);
