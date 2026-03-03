import { useCallback, useRef, useState } from "react";
import { ActionIcon, Tooltip, Menu } from "@mantine/core";
import {
  IconArrowUp,
  IconPaperclip,
  IconPlayerStop,
  IconPencil,
  IconPencilOff,
  IconTemplate,
  IconPlus,
  IconRotate,
  IconEdit,
  IconTrash,
  IconBrain,
} from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { NodeSelection } from "@tiptap/pm/state";
import { useParams } from "react-router-dom";
import { extractPageSlugId } from "@/lib";
import {
  pageEditorAtom,
  titleEditorAtom,
} from "@/features/editor/atoms/editor-atoms";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { markdownToHtml } from "@docmost/editor-ext";
import { v7 as uuid7 } from "uuid";
import {
  aiCreatorFilesAtom,
  aiCreatorTemplateAtom,
  aiCreatorSelectionAtom,
  aiCreatorSelectionRangeAtom,
  aiCreatorMessagesAtom,
  aiCreatorStreamingAtom,
  aiCreatorAutoInsertAtom,
  useTemplateAtom,
  agentModeAtom,
} from "./ai-creator-atoms";
import { AiCreatorFileList } from "./ai-creator-file-list";
import { AI_TEMPLATE_OPTIONS } from "./ai-creator.types";
import type { SelectionSnapshot } from "./ai-creator.types";
import { extractTitle, isSelectionStillValid } from './ai-creator-utils';
import {
  useAiTemplatesQuery,
  useResetAiTemplateMutation,
  useDeleteAiTemplateMutation,
} from "@/ee/ai/queries/ai-template-query";
import { IAiTemplate } from "@/ee/ai/types/ai-template.types";
import AiTemplateEditor from "@/ee/ai/components/ai-templates/ai-template-editor";
import {
  creatorGenerate,
} from "@/ee/ai/services/ai-service";
import { useAgent } from "@/ee/ai/hooks/use-agent";
import classes from "./ai-creator.module.css";

const ACCEPTED_FILES = ".pdf,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp";
const IMAGE_MIMETYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_FILES = 5;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function renderMarkdownToEditorHtml(content: string): string {
  return markdownToHtml(content) as string;
}

export function AiCreatorInput() {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
  const pageId = extractPageSlugId(pageSlug);
  const editor = useAtomValue(pageEditorAtom);
  const titleEditor = useAtomValue(titleEditorAtom);
  const [files, setFiles] = useAtom(aiCreatorFilesAtom);
  const [template, setTemplate] = useTemplateAtom();
  const selection = useAtomValue(aiCreatorSelectionAtom);
  const selectionRange = useAtomValue(aiCreatorSelectionRangeAtom);
  const [allMessages, setAllMessages] = useAtom(aiCreatorMessagesAtom);
  const [isStreaming, setIsStreaming] = useAtom(aiCreatorStreamingAtom);
  const [autoInsert, setAutoInsert] = useAtom(aiCreatorAutoInsertAtom);
  const [agentMode, setAgentMode] = useAtom(agentModeAtom);
  const [prompt, setPrompt] = useState("");
  const { run: runAgent, stop: stopAgent } = useAgent(pageId);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // User template personalization state
  const [userEditorOpened, setUserEditorOpened] = useState(false);
  const [editingUserTemplate, setEditingUserTemplate] = useState<IAiTemplate | null>(null);
  const resetMutation = useResetAiTemplateMutation();
  const deleteMutation = useDeleteAiTemplateMutation();

  const { data: dynamicTemplates } = useAiTemplatesQuery();

  const pageHasContent =
    editor && editor.state.doc.textContent.trim().length > 0;
  const pageTitle = titleEditor?.state.doc.textContent || "";

  const addMessage = useCallback(
    (msg: any) => {
      setAllMessages((prev) => {
        const pageMessages = prev[pageId] || [];
        return { ...prev, [pageId]: [...pageMessages, msg] };
      });
    },
    [pageId, setAllMessages],
  );

  const updateLastMessage = useCallback(
    (updater: (content: string) => string) => {
      setAllMessages((prev) => {
        const pageMessages = [...(prev[pageId] || [])];
        const last = pageMessages[pageMessages.length - 1];
        if (last && last.role === "assistant") {
          pageMessages[pageMessages.length - 1] = {
            ...last,
            content: updater(last.content),
          };
        }
        return { ...prev, [pageId]: pageMessages };
      });
    },
    [pageId, setAllMessages],
  );

  /** Remove the last message if it's an empty assistant message (error/abort cleanup) */
  const removeLastEmptyAssistant = useCallback(() => {
    setAllMessages((prev) => {
      const msgs = [...(prev[pageId] || [])];
      if (
        msgs.length > 0 &&
        msgs[msgs.length - 1].role === 'assistant' &&
        !msgs[msgs.length - 1].content.trim()
      ) {
        msgs.pop();
      }
      return { ...prev, [pageId]: msgs };
    });
  }, [pageId, setAllMessages]);

  const handleFileUpload = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    const validFiles = newFiles.filter((f) => {
      if (f.size > MAX_FILE_SIZE) {
        notifications.show({ color: "red", message: `${f.name} exceeds 20MB` });
        return false;
      }
      return true;
    });
    setFiles((prev) => [...prev, ...validFiles].slice(0, MAX_FILES));
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.files;
    if (!items || items.length === 0) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const file = items[i];
      if (!IMAGE_MIMETYPES.has(file.type)) continue;
      if (file.size > MAX_FILE_SIZE) {
        notifications.show({ color: "red", message: `${file.name} exceeds 20MB` });
        continue;
      }
      // Rename clipboard screenshots to something meaningful
      const name = file.name === "image.png" || file.name === ""
        ? `paste-${Date.now()}.${file.type.split("/")[1]}`
        : file.name;
      imageFiles.push(new File([file], name, { type: file.type }));
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      setFiles((prev) => [...prev, ...imageFiles].slice(0, MAX_FILES));
    }
  };

  const handleStop = () => {
    if (agentMode) {
      stopAgent();
    } else {
      abortRef.current?.abort();
    }
    removeLastEmptyAssistant();
    setIsStreaming(false);
  };

  const handleSubmit = async () => {
    if (!prompt.trim() || isStreaming || !editor) return;

    const userPrompt = prompt.trim();
    setPrompt("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setIsStreaming(true);

    // Build prompt with selection context if available
    let fullPrompt = userPrompt;
    if (selection) {
      fullPrompt =
        `[CRITICAL INSTRUCTION]\n` +
        `The user has selected a specific portion of text for you to modify.\n` +
        `You MUST ONLY output the modified version of the selected text below.\n` +
        `STRICTLY FORBIDDEN: Do NOT rewrite the entire article, do NOT add content outside the scope of the selected text, do NOT output any surrounding context.\n` +
        `Only return the replacement for the selected text, nothing more.\n\n` +
        `[Selected text to modify]\n${selection}\n\n` +
        `[User request]\n${userPrompt}`;
    }

    addMessage({
      id: uuid7(),
      role: "user",
      content: userPrompt,
      timestamp: Date.now(),
      selectionContext: selection || undefined,
      selectionRange: selectionRange || undefined,
    });

    addMessage({
      id: uuid7(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    });

    const startTime = Date.now();

    // Capture selection snapshot for validation before insertion (P0-1)
    const selectionSnapshot: SelectionSnapshot | null = selectionRange
      ? {
          text: editor.state.doc.textBetween(selectionRange.from, selectionRange.to),
          from: selectionRange.from,
          to: selectionRange.to,
        }
      : null;

    try {
      let accumulatedContent = "";
      // Determine insert mode: append when page has content and no selection
      const shouldAppend = pageHasContent && !selection;

      // Build conversation history from existing messages (max 10 recent)
      const pageMessages = allMessages[pageId] || [];
      // Exclude the two messages we just added (user + empty assistant)
      const existingMessages = pageMessages.slice(0, -2);
      const history = existingMessages
        .filter((m) => m.content.trim().length > 0)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: (() => {
            if (m.role === "assistant") {
              return m.content.replace(/\n+---\n\*[\d.]+s\*\s*$/, '').trim();
            }
            // Include truncated selection context for multi-turn continuity (P1-2)
            if (m.selectionContext) {
              return `[修改选区内容]\n${m.selectionContext.slice(0, 200)}\n\n${m.content}`;
            }
            return m.content;
          })(),
        }))
        .slice(-10);

      // ========== Agent 模式 ==========
      if (agentMode) {
        runAgent(
          {
            files,
            prompt: fullPrompt,
            pageId,
            templateId: template || undefined,
            insertMode: shouldAppend ? "append" : selection ? "replace" : "create",
            pageTitle,
            pageContent: editor.state.doc.textBetween(0, Math.min(5000, editor.state.doc.content.size)),
            selectedText: selection || undefined,
            selectionRange: selectionRange || undefined,
            history: history.length > 0 ? history : undefined,
          },
          {
            onContent: (chunk) => {
              accumulatedContent += chunk;
              updateLastMessage(() => accumulatedContent);
            },
            onDone: (finalContent, insertMode) => {
              // Use finalContent if available (otherwise use accumulated)
              const content = finalContent || accumulatedContent;
              if (autoInsert && content && editor) {
                let markdown = content;
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
                const html = renderMarkdownToEditorHtml(markdown);
                if (html) {
                  if (insertMode === "replace" && selectionSnapshot && isSelectionStillValid(editor, selectionSnapshot)) {
                    editor.chain().focus().setTextSelection(selectionSnapshot).insertContent(html).run();
                  } else {
                    editor.chain().focus("end").insertContent(html).run();
                  }
                }
              }
              setIsStreaming(false);
              setFiles([]);
              const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
              updateLastMessage((c) => c + `\n\n---\n*${elapsed}s*`);
            },
            onError: (msg) => {
              removeLastEmptyAssistant();
              notifications.show({ color: "red", message: msg });
              setIsStreaming(false);
            },
          },
        );
        return;
      }

      // ========== 普通模式 ==========
      abortRef.current = await creatorGenerate(
        {
          files,
          prompt: fullPrompt,
          template: template || undefined,
          pageId,
          insertMode: shouldAppend ? "append" : undefined,
          existingContentSummary: shouldAppend
            ? editor.state.doc.textBetween(0, Math.min(500, editor.state.doc.content.size))
            : undefined,
          pageTitle,
          history: history.length > 0 ? history : undefined,
        },
        (chunk) => {
          accumulatedContent += chunk.content;
          updateLastMessage(() => accumulatedContent);
        },
        (error) => {
          removeLastEmptyAssistant();
          notifications.show({ color: "red", message: error.error });
          setIsStreaming(false);
        },
        () => {
          // Auto-insert to editor when toggle is on
          if (autoInsert && accumulatedContent) {
            let markdown = accumulatedContent;
            // Extract title
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

            if (selectionSnapshot && isSelectionStillValid(editor, selectionSnapshot)) {
              // Selection still valid — replace it
              const $from = editor.state.doc.resolve(selectionSnapshot.from);
              const isInCodeBlock = $from.parent.type.name === "codeBlock";
              const isCodeBlockNodeSelected =
                editor.state.selection instanceof NodeSelection &&
                (editor.state.selection as NodeSelection).node.type.name === "codeBlock";

              if (isInCodeBlock || isCodeBlockNodeSelected) {
                const codeMatch = markdown.match(/```[\w]*\n([\s\S]*?)```/);
                const plainCode = codeMatch ? codeMatch[1].replace(/\n$/, "") : markdown;

                if (isCodeBlockNodeSelected) {
                  const oldNode = (editor.state.selection as NodeSelection).node;
                  const language = oldNode.attrs.language || "mermaid";
                  const newNode = editor.state.schema.nodes.codeBlock.create(
                    { language },
                    plainCode ? editor.state.schema.text(plainCode) : undefined,
                  );
                  const { tr } = editor.state;
                  tr.replaceWith(selectionSnapshot.from, selectionSnapshot.to, newNode);
                  editor.view.dispatch(tr);
                } else {
                  const { tr } = editor.state;
                  tr.insertText(plainCode, selectionSnapshot.from, selectionSnapshot.to);
                  editor.view.dispatch(tr);
                }
              } else {
                const html = renderMarkdownToEditorHtml(markdown);
                if (html) {
                  editor.chain().focus().setTextSelection(selectionSnapshot).insertContent(html).run();
                }
              }
            } else if (selectionSnapshot) {
              // Selection became stale — fallback to append (P0-1)
              const html = renderMarkdownToEditorHtml(markdown);
              if (html) {
                editor.chain().focus("end").insertContent(html).run();
              }
              notifications.show({
                color: "yellow",
                message: t("Selection changed during generation. Content appended to end."),
              });
            } else {
              // No selection — append to end
              const html = renderMarkdownToEditorHtml(markdown);
              if (html) {
                editor.chain().focus("end").insertContent(html).run();
              }
            }
          }
          setIsStreaming(false);
          setFiles([]);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          updateLastMessage((c) => c + `\n\n---\n*${elapsed}s*`);
        },
      );
    } catch (error: any) {
      removeLastEmptyAssistant();
      notifications.show({ color: "red", message: error.message });
      setIsStreaming(false);
    }
  };

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    autoResize();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Use dynamic templates from API, fallback to static
  const templateOptions = dynamicTemplates
    ? dynamicTemplates
    : AI_TEMPLATE_OPTIONS.map((st) => ({
        key: st.key, name: st.name, prompt: "", scope: 'system' as const,
        source: 'system' as const, canReset: false, canEdit: false, canDelete: false, isDefault: true,
      } as IAiTemplate));

  const selectedTemplateOption = template
    ? templateOptions.find((opt) => opt.key === template)
    : null;
  const selectedTemplateName = selectedTemplateOption ? t(selectedTemplateOption.name) : null;

  const handleEditTemplate = (tmpl: IAiTemplate) => {
    setEditingUserTemplate(tmpl);
    setUserEditorOpened(true);
  };

  const handleCreateUserTemplate = () => {
    setEditingUserTemplate(null);
    setUserEditorOpened(true);
  };

  const handleDeleteTemplate = async (tmpl: IAiTemplate) => {
    if (!tmpl.id) return;
    try {
      await deleteMutation.mutateAsync({ templateId: tmpl.id });
      if (template === tmpl.key) setTemplate(null);
      notifications.show({ message: t("Template deleted"), color: "green" });
    } catch (err: any) {
      notifications.show({ message: err?.response?.data?.message || t("Failed to delete"), color: "red" });
    }
  };

  const handleResetTemplate = async (key: string) => {
    try {
      await resetMutation.mutateAsync({ key });
      notifications.show({ message: t("Reset to default"), color: "green" });
    } catch (err: any) {
      notifications.show({ message: err?.response?.data?.message || t("Failed to reset"), color: "red" });
    }
  };

  return (
    <div className={classes.inputArea}>
      {/* File chips above input box */}
      <AiCreatorFileList />

      {/* Input container - LobeHub style */}
      <div className={classes.inputBox}>
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          data-ai-input
          className={classes.inputTextarea}
          rows={3}
          placeholder={
            selection
              ? t("Ask about the selected text...  Press Shift+Enter for new line")
              : t("Describe what to create...  Press Shift+Enter for new line")
          }
          value={prompt}
          onChange={handlePromptChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={isStreaming}
        />

        {/* Bottom toolbar */}
        <div className={classes.inputToolbar}>
          {/* Left side: template, upload, auto-insert toggle */}
          <div className={classes.inputToolbarLeft}>
            {/* Template selector */}
            <Menu shadow="md" width={180} position="top-start">
              <Menu.Target>
                <Tooltip label={selectedTemplateName || t("Template")} openDelay={300}>
                  <ActionIcon
                    variant={template ? "light" : "subtle"}
                    color={template ? "indigo" : "gray"}
                    size="sm"
                  >
                    <IconTemplate size={16} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                {templateOptions.map((tmpl) => (
                  <Menu.Item
                    key={tmpl.key}
                    onClick={() => setTemplate(template === tmpl.key ? null : tmpl.key)}
                    style={template === tmpl.key ? { fontWeight: 600, color: '#6366f1' } : undefined}
                    rightSection={
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {tmpl.source === 'user' && (
                          <span style={{ fontSize: 10, color: '#888' }}>{t("Personal")}</span>
                        )}
                        {tmpl.canReset && (
                          <Tooltip label={t("Reset to default")} openDelay={300}>
                            <ActionIcon variant="subtle" size="xs" color="gray"
                              onClick={(e) => { e.stopPropagation(); handleResetTemplate(tmpl.key); }}
                            ><IconRotate size={12} /></ActionIcon>
                          </Tooltip>
                        )}
                        {tmpl.canEdit && (
                          <Tooltip label={t("Edit")} openDelay={300}>
                            <ActionIcon variant="subtle" size="xs" color="gray"
                              onClick={(e) => { e.stopPropagation(); handleEditTemplate(tmpl); }}
                            ><IconEdit size={12} /></ActionIcon>
                          </Tooltip>
                        )}
                        {tmpl.canDelete && (
                          <Tooltip label={t("Delete")} openDelay={300}>
                            <ActionIcon variant="subtle" size="xs" color="red"
                              onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tmpl); }}
                            ><IconTrash size={12} /></ActionIcon>
                          </Tooltip>
                        )}
                      </span>
                    }
                  >
                    {t(tmpl.name)}
                  </Menu.Item>
                ))}
                <Menu.Divider />
                <Menu.Item
                  leftSection={<IconPlus size={14} />}
                  onClick={handleCreateUserTemplate}
                >
                  {t("New template")}
                </Menu.Item>
                {template && (
                  <Menu.Item color="dimmed" onClick={() => setTemplate(null)}>
                    {t("Clear template")}
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>

            {/* Upload files */}
            <Tooltip label={t("Upload files")} openDelay={300}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={handleFileUpload}
                disabled={isStreaming || files.length >= MAX_FILES}
              >
                <IconPaperclip size={16} />
              </ActionIcon>
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILES}
              multiple
              style={{ display: "none" }}
              onChange={handleFileChange}
            />

            {/* Auto-insert toggle */}
            <Tooltip
              label={autoInsert ? t("Auto-insert ON: AI writes directly to editor") : t("Auto-insert OFF: Manual insert")}
              openDelay={300}
            >
              <ActionIcon
                variant={autoInsert ? "light" : "subtle"}
                color={autoInsert ? "indigo" : "gray"}
                size="sm"
                onClick={() => setAutoInsert(!autoInsert)}
              >
                {autoInsert ? <IconPencil size={16} /> : <IconPencilOff size={16} />}
              </ActionIcon>
            </Tooltip>

            {/* Agent deep mode toggle */}
            <Tooltip
              label={agentMode ? t("Deep mode ON: Agent researches before writing") : t("Deep mode: Enable AI agent for research & multi-step generation")}
              openDelay={300}
            >
              <ActionIcon
                variant={agentMode ? "filled" : "subtle"}
                color={agentMode ? "violet" : "gray"}
                size="sm"
                onClick={() => setAgentMode(!agentMode)}
              >
                <IconBrain size={16} />
              </ActionIcon>
            </Tooltip>
          </div>

          {/* Right side: send/stop */}
          <div className={classes.inputToolbarRight}>
            {isStreaming ? (
              <ActionIcon variant="filled" color="red" radius="xl" size="sm" onClick={handleStop}>
                <IconPlayerStop size={14} />
              </ActionIcon>
            ) : (
              <ActionIcon
                variant="filled"
                color="indigo"
                radius="xl"
                size="sm"
                onClick={handleSubmit}
                disabled={!prompt.trim()}
              >
                <IconArrowUp size={14} stroke={2.5} />
              </ActionIcon>
            )}
          </div>
        </div>
      </div>
      {/* Template editor modal */}
      <AiTemplateEditor
        opened={userEditorOpened}
        onClose={() => setUserEditorOpened(false)}
        template={editingUserTemplate}
        scope={editingUserTemplate?.scope === 'workspace' ? 'workspace' : 'user'}
      />
    </div>
  );
}
