import { useCallback, useRef, useState } from "react";
import { ActionIcon, Tooltip, Menu } from "@mantine/core";
import {
  IconArrowUp,
  IconPaperclip,
  IconPlayerStop,
  IconPencil,
  IconPencilOff,
  IconTemplate,
} from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
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
} from "./ai-creator-atoms";
import { AiCreatorFileList } from "./ai-creator-file-list";
import { AI_TEMPLATE_OPTIONS } from "./ai-creator.types";
import {
  creatorGenerate,
} from "@/ee/ai/services/ai-service";
import classes from "./ai-creator.module.css";

const ACCEPTED_FILES = ".pdf,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp";
const MAX_FILES = 5;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function extractTitle(markdown: string): [string | null, string] {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (!match) return [null, markdown];
  const title = match[1].trim();
  const remaining = markdown.replace(/^#\s+.+\n*/m, "").trim();
  return [title, remaining];
}

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
  const [template, _setTemplate] = useAtom(aiCreatorTemplateAtom);
  const setTemplate = _setTemplate as (v: string | null) => void;
  const selection = useAtomValue(aiCreatorSelectionAtom);
  const selectionRange = useAtomValue(aiCreatorSelectionRangeAtom);
  const [, setAllMessages] = useAtom(aiCreatorMessagesAtom);
  const [isStreaming, setIsStreaming] = useAtom(aiCreatorStreamingAtom);
  const [autoInsert, _setAutoInsert] = useAtom(aiCreatorAutoInsertAtom);
  const setAutoInsert = _setAutoInsert as (v: boolean) => void;
  const [prompt, setPrompt] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleStop = () => {
    abortRef.current?.abort();
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
      fullPrompt = `[Selected text context]\n${selection}\n\n[User request]\n${userPrompt}`;
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

    try {
      let accumulatedContent = "";
      abortRef.current = await creatorGenerate(
        {
          files,
          prompt: fullPrompt,
          template: template || undefined,
          pageId,
          existingContentSummary: pageHasContent
            ? editor.state.doc.textBetween(0, Math.min(500, editor.state.doc.content.size))
            : undefined,
          pageTitle,
        },
        (chunk) => {
          accumulatedContent += chunk.content;
          updateLastMessage(() => accumulatedContent);
        },
        (error) => {
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
            const html = renderMarkdownToEditorHtml(markdown);
            if (html) {
              editor.chain().focus("end").insertContent(html).run();
            }
          }
          setIsStreaming(false);
          setFiles([]);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          updateLastMessage((c) => c + `\n\n---\n*${elapsed}s*`);
        },
      );
    } catch (error: any) {
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

  const selectedTemplateOption = template
    ? AI_TEMPLATE_OPTIONS.find((opt) => opt.key === template)
    : null;
  const selectedTemplateName = selectedTemplateOption ? t(selectedTemplateOption.name) : null;

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
                {AI_TEMPLATE_OPTIONS.map((tmpl) => (
                  <Menu.Item
                    key={tmpl.key}
                    onClick={() => setTemplate(template === tmpl.key ? null : tmpl.key)}
                    style={template === tmpl.key ? { fontWeight: 600, color: '#6366f1' } : undefined}
                  >
                    {t(tmpl.name)}
                  </Menu.Item>
                ))}
                {template && (
                  <>
                    <Menu.Divider />
                    <Menu.Item color="dimmed" onClick={() => setTemplate(null)}>
                      {t("Clear template")}
                    </Menu.Item>
                  </>
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
    </div>
  );
}
