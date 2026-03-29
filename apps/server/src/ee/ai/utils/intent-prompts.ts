import { QueryIntent } from '../services/query-understanding.service';

const INTENT_INSTRUCTIONS_ZH: Record<QueryIntent, string> = {
  factual:
    '用户在查找一个具体事实。请简洁直答，1-3 句话给出答案，附上来源编号 [1][2]。如果上下文中没有答案，直接说明。',
  procedural:
    '用户需要操作步骤。请用编号列表给出清晰的分步骤指南，每步包含具体命令或操作。如有代码，用代码块格式。引用来源 [1][2]。',
  conceptual:
    '用户想理解一个概念。请先用 1-2 句话给出概述，然后展开解释关键要点。由浅入深，适合不同知识水平的读者。引用来源 [1][2]。',
  troubleshooting:
    '用户遇到了问题需要排障。请给出排查思路：先列出可能原因（按可能性排序），然后对每个原因给出检查方法和解决方案。引用来源 [1][2]。',
  comparison:
    '用户想对比不同选项。请用表格对比关键维度（功能、优缺点、适用场景等），最后给出总结推荐。引用来源 [1][2]。',
  follow_up:
    '用户在追问上一个话题。基于已有对话深入回答，不要重复已经说过的内容。引用来源 [1][2]。',
};

const INTENT_INSTRUCTIONS_EN: Record<QueryIntent, string> = {
  factual:
    'The user is looking for a specific fact. Answer directly and concisely in 1-3 sentences, citing sources [1][2]. If the context does not contain the answer, say so explicitly.',
  procedural:
    'The user needs step-by-step instructions. Provide a clear numbered guide with concrete commands or actions at each step. Use code blocks for any commands or code. Cite sources [1][2].',
  conceptual:
    'The user wants to understand a concept. Start with a 1-2 sentence overview, then expand on key points from simple to complex, suitable for readers of varying knowledge levels. Cite sources [1][2].',
  troubleshooting:
    'The user has a problem and needs help diagnosing it. List likely causes in order of probability, then provide a check method and resolution for each. Cite sources [1][2].',
  comparison:
    'The user wants to compare different options. Use a table to compare key dimensions (features, pros/cons, use cases, etc.), then provide a summary recommendation. Cite sources [1][2].',
  follow_up:
    'The user is following up on a previous topic. Build on the existing conversation and go deeper without repeating what has already been said. Cite sources [1][2].',
};

const BASE_CONSTRAINTS_ZH = `请只根据给定上下文回答问题。优先参考标记为 Current page 的内容。
引用下载、预览或图片地址时，只能使用上下文里已经给出的链接。
如果上下文没有提供有效链接，就明确说不知道，不要猜测 URL。
当上下文中出现 ![...](url) 格式的图片时，请保持该格式原样输出。
在回答中使用 [1]、[2] 等编号引用上下文来源。`;

const BASE_CONSTRAINTS_EN = `Answer strictly from the provided context. Prioritize the source marked as Current page.
Only use links that already appear in the context. If no valid URL provided, say you don't know.
Preserve ![...](url) image format from context.
Use [1], [2] etc. to cite context sources in your answer.`;

export function getIntentSystemPrompt(
  intent: QueryIntent,
  isChinese: boolean,
  context: string,
): string {
  const intentInstruction = isChinese
    ? INTENT_INSTRUCTIONS_ZH[intent]
    : INTENT_INSTRUCTIONS_EN[intent];

  const baseConstraints = isChinese ? BASE_CONSTRAINTS_ZH : BASE_CONSTRAINTS_EN;

  const contextSection = context || 'No relevant context available.';

  return `${intentInstruction}\n\n${baseConstraints}\n\nContext:\n${contextSection}`;
}
