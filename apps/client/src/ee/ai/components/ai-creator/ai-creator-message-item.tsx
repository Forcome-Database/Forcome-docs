import { ActionIcon, Text, Tooltip } from "@mantine/core";
import {
  IconCopy,
  IconArrowBarDown,
  IconReplace,
  IconUser,
  IconSparkles,
} from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { pageEditorAtom, titleEditorAtom } from "@/features/editor/atoms/editor-atoms";
import { aiCreatorSelectionAtom, aiCreatorSelectionRangeAtom } from "./ai-creator-atoms";
import { notifications } from "@mantine/notifications";
import { AiCreatorMessage } from "./ai-creator.types";
import { Marked } from "marked";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import { markdownToHtml } from "@docmost/editor-ext";
import { useTranslation } from "react-i18next";
import { useCallback } from "react";
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
      return `<pre class="code-block-wrapper" data-language="${langLabel}"><code class="hljs language-${langLabel}">${highlighted}</code></pre>`;
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
  ],
  ALLOWED_ATTR: ['class', 'href', 'target', 'rel', 'src', 'alt', 'title', 'data-language'],
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
}

/** Extract first H1 from markdown, return [title, remainingMarkdown] */
function extractTitle(markdown: string): [string | null, string] {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (!match) return [null, markdown];
  const title = match[1].trim();
  const remaining = markdown.replace(/^#\s+.+\n*/m, '').trim();
  return [title, remaining];
}

/** Strip trailing elapsed-time line (e.g. "\n\n---\n*2.5s*") */
function stripTimestamp(content: string): string {
  return content.replace(/\n+---\n\*[\d.]+s\*\s*$/, '').trim();
}

export function AiCreatorMessageItem({ message }: Props) {
  const { t } = useTranslation();
  const editor = useAtomValue(pageEditorAtom);
  const titleEditor = useAtomValue(titleEditorAtom);
  const selection = useAtomValue(aiCreatorSelectionAtom);
  const selectionRange = useAtomValue(aiCreatorSelectionRangeAtom);
  const isUser = message.role === "user";

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
    const html = renderEditorHtml(markdown);
    editor.chain().focus().setTextSelection(selectionRange).insertContent(html).run();
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
          <IconSparkles size={16} />
        </div>
        <div className={classes.messageAiBubbleWrap}>
          <div
            className={classes.messageAiBubble}
            onClick={handleCodeBlockCopy}
          >
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
              {selection && selectionRange && (
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
