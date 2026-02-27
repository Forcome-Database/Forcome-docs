import { atom } from 'jotai';
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
