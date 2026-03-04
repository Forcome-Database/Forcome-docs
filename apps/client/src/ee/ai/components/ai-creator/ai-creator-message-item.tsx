import { ActionIcon, Text, Tooltip } from "@mantine/core";
import {
  IconCopy,
  IconArrowBarDown,
  IconReplace,
  IconUser,
} from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { NodeSelection } from "@tiptap/pm/state";
import { pageEditorAtom, titleEditorAtom } from "@/features/editor/atoms/editor-atoms";
import { aiCreatorSelectionAtom, aiCreatorSelectionRangeAtom, agentModeAtom, agentStepsAtom } from "./ai-creator-atoms";
import { notifications } from "@mantine/notifications";
import { AiCreatorMessage } from "./ai-creator.types";
import { Marked } from "marked";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import { markdownToHtml } from "@docmost/editor-ext";
import { useTranslation } from "react-i18next";
import { useCallback } from "react";
import { useParams } from "react-router-dom";
import { extractPageSlugId } from "@/lib";
import { AiCreatorAgentSteps } from "./ai-creator-agent-steps";
import { AiCreatorClarifyBubble } from './ai-creator-clarify-bubble';
import { AiCreatorProposeBubble } from './ai-creator-propose-bubble';
import { AiCreatorOutlineBubble } from './ai-creator-outline-bubble';
import classes from "./ai-creator.module.css";

// Create an ISOLATED marked instance for bubble rendering (with hljs highlight)
// This does NOT affect the global `marked` used by editor-ext's markdownToHtml
const bubbleMarked = new Marked({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      if (!text) return '<pre><code></code></pre>\n';
      const language = lang && hljs.getLanguage(lang) ? lang : null;
      let highlighted: string;
      try {
        highlighted = language
          ? hljs.highlight(text, { language }).value
          : hljs.highlightAuto(text).value;
      } catch {
        highlighted = text;
      }
      const langLabel = language || lang || "";
      const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      return `<pre class="code-block-wrapper" data-language="${langLabel}"><button class="code-copy-btn" title="Copy">${copyIcon}</button><code class="hljs language-${langLabel}">${highlighted}</code></pre>`;
    },
  },
});

// DOMPurify config for bubble display
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'pre', 'code', 'span',
    'blockquote', 'hr',
    'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img', 'div',
    'button', 'svg', 'rect', 'path', 'line', 'circle',
  ],
  ALLOWED_ATTR: [
    'class', 'href', 'target', 'rel', 'src', 'alt', 'title', 'data-language',
    'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'd', 'x', 'y', 'width', 'height', 'rx', 'ry', 'xmlns',
  ],
  ALLOWED_URI_REGEXP: /^(?:https?|data):/i,
};

/** Render markdown for display in the chat bubble (with hljs highlight) */
function renderBubbleHtml(content: string): string {
  try {
    const raw = bubbleMarked.parse(content) as string;
    return DOMPurify.sanitize(raw, PURIFY_CONFIG);
  } catch {
    return DOMPurify.sanitize(content, PURIFY_CONFIG);
  }
}

/** Render markdown for insertion into TipTap editor (uses editor's own pipeline) */
function renderEditorHtml(content: string): string {
  return markdownToHtml(content) as string;
}

interface Props {
  message: AiCreatorMessage;
  isLast?: boolean;
  onResume?: (value: Record<string, any>) => void;
}

import { extractTitle, stripTimestamp } from './ai-creator-utils';

export function AiCreatorMessageItem({ message, isLast, onResume }: Props) {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
  const pageId = extractPageSlugId(pageSlug);
  const editor = useAtomValue(pageEditorAtom);
  const titleEditor = useAtomValue(titleEditorAtom);
  const selection = useAtomValue(aiCreatorSelectionAtom);
  const selectionRange = useAtomValue(aiCreatorSelectionRangeAtom);
  const agentMode = useAtomValue(agentModeAtom);
  const allSteps = useAtomValue(agentStepsAtom);
  const agentSteps = allSteps[pageId] || [];
  const isUser = message.role === "user";

  // Handle interactive message types
  if (message.role === 'clarify' && onResume) {
    return <AiCreatorClarifyBubble message={message} onResume={onResume} />;
  }
  if (message.role === 'propose' && onResume) {
    return <AiCreatorProposeBubble message={message} onResume={onResume} />;
  }
  if (message.role === 'outline' && onResume) {
    return <AiCreatorOutlineBubble message={message} onResume={onResume} />;
  }

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content);
    notifications.show({ message: t("Copied") });
  }, [message.content, t]);

  const handleInsert = useCallback(() => {
    if (!editor) return;

    let markdown = stripTimestamp(message.content);

    // Extract H1 as page title if the current title is empty
    if (titleEditor) {
      const currentTitle = titleEditor.state.doc.textContent.trim();
      if (!currentTitle) {
        const [title, remaining] = extractTitle(markdown);
        if (title) {
          titleEditor.commands.setContent(title);
          markdown = remaining;
        }
      }
    }

    const html = renderEditorHtml(markdown);
    if (html) {
      editor.chain().focus("end").insertContent(html).run();
    }
    notifications.show({ message: t("Inserted") });
  }, [editor, titleEditor, message.content, t]);

  const handleReplace = useCallback(() => {
    if (!editor || !selectionRange) return;
    const markdown = stripTimestamp(message.content);

    // Determine if the selection is inside or on a code block
    const $from = editor.state.doc.resolve(selectionRange.from);
    const isInCodeBlock = $from.parent.type.name === "codeBlock";
    const isCodeBlockNodeSelected =
      editor.state.selection instanceof NodeSelection &&
      (editor.state.selection as NodeSelection).node.type.name === "codeBlock";

    if (isInCodeBlock || isCodeBlockNodeSelected) {
      // Extract plain code from AI markdown response (strip code fences)
      const codeMatch = markdown.match(/```[\w]*\n([\s\S]*?)```/);
      const plainCode = codeMatch ? codeMatch[1].replace(/\n$/, "") : markdown;

      if (isCodeBlockNodeSelected) {
        // Replace the entire code block node, preserving its language attribute
        const oldNode = (editor.state.selection as NodeSelection).node;
        const language = oldNode.attrs.language || "mermaid";
        const newNode = editor.state.schema.nodes.codeBlock.create(
          { language },
          plainCode ? editor.state.schema.text(plainCode) : undefined,
        );
        const { tr } = editor.state;
        tr.replaceWith(selectionRange.from, selectionRange.to, newNode);
        editor.view.dispatch(tr);
      } else {
        // Replace text inside the code block using insertText
        const { tr } = editor.state;
        tr.insertText(plainCode, selectionRange.from, selectionRange.to);
        editor.view.dispatch(tr);
      }
    } else {
      const html = renderEditorHtml(markdown);
      editor.chain().focus().setTextSelection(selectionRange).insertContent(html).run();
    }

    notifications.show({ message: t("Replaced") });
  }, [editor, message.content, selectionRange, t]);

  const handleCodeBlockCopy = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('code-copy-btn') || target.closest('.code-copy-btn')) {
      const pre = target.closest('pre');
      const code = pre?.querySelector('code');
      if (code) {
        navigator.clipboard.writeText(code.textContent || '');
        notifications.show({ message: t("Copied") });
      }
    }
  }, [t]);

  if (isUser) {
    return (
      <div className={classes.messageUser}>
        <div className={classes.messageBubbleRow + " " + classes.messageBubbleRowUser}>
          <div className={classes.messageUserBubble}>
            {message.selectionContext && (
              <div className={classes.selectionQuote}>
                <Text size="xs" lineClamp={2} style={{ whiteSpace: "pre-wrap" }}>
                  {message.selectionContext}
                </Text>
              </div>
            )}
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {message.content}
            </Text>
          </div>
          <div className={classes.avatarUser}>
            <IconUser size={16} />
          </div>
        </div>
      </div>
    );
  }

  const renderedHtml = renderBubbleHtml(message.content);

  return (
    <div className={classes.messageAi}>
      <div className={classes.messageBubbleRow + " " + classes.messageBubbleRowAi}>
        <div className={classes.avatarAi}>
          <img src="/icons/app-icon-192x192.png" alt="" width={28} height={28} />
        </div>
        <div className={classes.messageAiBubbleWrap}>
          <div
            className={classes.messageAiBubble}
            onClick={handleCodeBlockCopy}
          >
            {isLast && agentMode && agentSteps.length > 0 && (
              <AiCreatorAgentSteps steps={agentSteps} />
            )}
            <div
              className={classes.aiContent}
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>

          {message.content.length > 0 && (
            <div className={classes.messageActions}>
              <Tooltip label={t("Copy")} openDelay={300}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="xs"
                  onClick={handleCopy}
                >
                  <IconCopy size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("Insert to editor")} openDelay={300}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="xs"
                  onClick={handleInsert}
                >
                  <IconArrowBarDown size={14} />
                </ActionIcon>
              </Tooltip>
              {selectionRange && (
                <Tooltip label={t("Replace selection")} openDelay={300}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="xs"
                    onClick={handleReplace}
                  >
                    <IconReplace size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
