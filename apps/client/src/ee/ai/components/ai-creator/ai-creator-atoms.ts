import { atom, useAtom } from 'jotai';
import { atomWithWebStorage } from '@/lib/jotai-helper';
import { AiCreatorMessage } from './ai-creator.types';

export const aiCreatorFilesAtom = atom<File[]>([]);

export const aiCreatorAutoInsertAtom = atomWithWebStorage<boolean>('aiAutoInsert', false);

export const aiCreatorTemplateAtom = atom<string | null>(null);

export const aiCreatorSelectionAtom = atom<string>('');

export interface SelectionRange {
  from: number;
  to: number;
}

export const aiCreatorSelectionRangeAtom = atom<SelectionRange | null>(null);

export const aiCreatorMessagesAtom = atom<
  Record<string, AiCreatorMessage[]>
>({});

export const aiCreatorStreamingAtom = atom<boolean>(false);

/**
 * Type-safe hook for the nullable template atom.
 * Eliminates the `_setX as (v: T | null) => void` pattern.
 */
export function useTemplateAtom(): [string | null, (value: string | null) => void] {
  const [value, setValue] = useAtom(aiCreatorTemplateAtom);
  return [value, setValue as (v: string | null) => void];
}

// Agent mode atoms
import { AgentStepInfo } from '../../types/agent.types';

export const agentModeAtom = atomWithWebStorage<boolean>('aiAgentMode', false);
export const agentStepsAtom = atom<Record<string, AgentStepInfo[]>>({});

// Thread ID for agent session (per page)
export const agentThreadIdAtom = atom<Record<string, string>>({});
