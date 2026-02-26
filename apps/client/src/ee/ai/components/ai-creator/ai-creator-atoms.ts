import { atom } from 'jotai';
import { AiCreatorMode, AiCreatorMessage, InsertMode } from './ai-creator.types';

export const aiCreatorModeAtom = atom<AiCreatorMode>('create');

export const aiCreatorModeLockAtom = atom<boolean>(false);

export const aiCreatorFilesAtom = atom<File[]>([]);

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

export const aiCreatorInsertModeAtom = atom<InsertMode>('append');
