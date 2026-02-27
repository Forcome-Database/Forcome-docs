export interface IAiTemplate {
  id?: string;
  key: string;
  name: string;
  description?: string;
  icon?: string;
  prompt: string;
  scope: 'system' | 'workspace' | 'user';
  source: 'system' | 'workspace' | 'user';
  canReset: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isDefault: boolean;
}

export interface ICreateAiTemplate {
  key: string;
  name: string;
  description?: string;
  icon?: string;
  prompt: string;
  scope: 'workspace' | 'user';
}

export interface IUpdateAiTemplate {
  templateId: string;
  name?: string;
  description?: string;
  icon?: string;
  prompt?: string;
}

export interface IDeleteAiTemplate {
  templateId: string;
}

export interface IResetAiTemplate {
  key: string;
}

export interface IUpdateSystemPrompt {
  systemPrompt: string;
}
