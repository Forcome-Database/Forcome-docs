import type { AgentOutlineArtifactPlanItem } from "../../types/agent.types";
import type { AgentAssetSummary } from "../../types/agent.types";

export interface AiCreatorMessage {
  id: string;
  role: 'user' | 'assistant' | 'clarify' | 'propose' | 'outline' | 'brief' | 'blueprint' | 'review';
  content: string;
  timestamp: number;
  selectionContext?: string;
  selectionRange?: { from: number; to: number };
  questions?: string[];                                    // for clarify role
  proposals?: { title: string; description: string }[];    // for propose role
  outline?: string;                                        // for outline role
  artifactPlan?: AgentOutlineArtifactPlanItem[];           // for outline role
  threadId?: string;                                       // session tracking
  // V2 data fields
  briefData?: Record<string, unknown>;                     // for brief role
  briefAssetSummary?: AgentAssetSummary;
  blueprintData?: Record<string, unknown>;                 // for blueprint role
  reviewData?: Record<string, unknown>;                    // for review role
}

export interface SelectionSnapshot {
  text: string;
  from: number;
  to: number;
}

export interface AiTemplate {
  key: string;
  name: string;
  icon: string;
  desc: string;
}

export const AI_TEMPLATE_OPTIONS: AiTemplate[] = [
  { key: 'technical-doc', name: 'Technical Documentation', icon: 'IconFileCode', desc: 'System architecture, API docs' },
  { key: 'operation-manual', name: 'Operation Manual', icon: 'IconBook', desc: 'Step-by-step guides' },
  { key: 'prd', name: 'Product PRD', icon: 'IconClipboardList', desc: 'Product requirement specs' },
  { key: 'report', name: 'Research Report', icon: 'IconChartBar', desc: 'Industry analysis & research' },
  { key: 'meeting-notes', name: 'Meeting Notes', icon: 'IconNotes', desc: 'Meeting records & resolutions' },
  { key: 'requirements', name: 'Requirements Analysis', icon: 'IconChecklist', desc: 'Feature breakdown' },
];
