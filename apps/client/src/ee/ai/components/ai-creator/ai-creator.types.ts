export type AiCreatorMode = 'create' | 'edit' | 'chat';

export type InsertMode = 'append' | 'overwrite';

export interface AiCreatorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode: AiCreatorMode;
  timestamp: number;
}

export interface AiTemplate {
  key: string;
  name: string;
}

export const AI_TEMPLATE_OPTIONS: AiTemplate[] = [
  { key: 'technical-doc', name: '技术文档' },
  { key: 'operation-manual', name: '操作手册' },
  { key: 'prd', name: '产品 PRD' },
  { key: 'report', name: '研究报告' },
  { key: 'meeting-notes', name: '会议纪要' },
  { key: 'requirements', name: '需求分析' },
];
