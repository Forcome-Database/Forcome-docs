export interface CreatorHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function parseCreatorHistory(
  historyRaw?: string,
): CreatorHistoryMessage[] {
  if (!historyRaw) {
    return [];
  }

  try {
    const parsed = JSON.parse(historyRaw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (message: any) =>
          (message?.role === 'user' || message?.role === 'assistant') &&
          typeof message?.content === 'string' &&
          message.content.trim().length > 0,
      )
      .map((message: any) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content.slice(0, 10000),
      }))
      .slice(-10);
  } catch {
    return [];
  }
}

export function isPlanningEnabled(planningEnabledRaw?: string): boolean {
  if (!planningEnabledRaw) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(planningEnabledRaw.toLowerCase());
}

export function shouldEnterOutlinePhase(
  planningEnabledRaw?: string,
  confirmedOutline: string = '',
): boolean {
  return isPlanningEnabled(planningEnabledRaw) && !confirmedOutline.trim();
}
