import { useCallback, useRef, useState } from "react";
import { ActionIcon, Group, Tooltip } from "@mantine/core";
import {
  IconArrowUp,
  IconPaperclip,
  IconPlayerStop,
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
import { marked } from "marked";
import { v7 as uuid7 } from "uuid";
import {
  aiCreatorModeAtom,
  aiCreatorFilesAtom,
  aiCreatorTemplateAtom,
  aiCreatorSelectionAtom,
  aiCreatorSelectionRangeAtom,
  aiCreatorMessagesAtom,
  aiCreatorStreamingAtom,
  aiCreatorInsertModeAtom,
} from "./ai-creator-atoms";
import { AiCreatorFileList } from "./ai-creator-file-list";
import { AiCreatorTemplates } from "./ai-creator-templates";
import {
  creatorGenerate,
  generateAiContentStream,
} from "@/ee/ai/services/ai-service";
import { AiAction } from "@/ee/ai/types/ai.types";
import classes from "./ai-creator.module.css";

const ACCEPTED_FILES = ".pdf,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp";
const MAX_FILES = 5;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export function AiCreatorInput() {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
  const pageId = extractPageSlugId(pageSlug);
  const editor = useAtomValue(pageEditorAtom);
  const titleEditor = useAtomValue(titleEditorAtom);
  const mode = useAtomValue(aiCreatorModeAtom);
  const [files, setFiles] = useAtom(aiCreatorFilesAtom);
  const template = useAtomValue(aiCreatorTemplateAtom);
  const selection = useAtomValue(aiCreatorSelectionAtom);
  const selectionRange = useAtomValue(aiCreatorSelectionRangeAtom);
  const [, setAllMessages] = useAtom(aiCreatorMessagesAtom);
  const [isStreaming, setIsStreaming] = useAtom(aiCreatorStreamingAtom);
  const insertMode = useAtomValue(aiCreatorInsertModeAtom);
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

    addMessage({
      id: uuid7(), role: "user", content: userPrompt, mode, timestamp: Date.now(),
    });
    addMessage({
      id: uuid7(), role: "assistant", content: "", mode, timestamp: Date.now(),
    });

    const startTime = Date.now();

    try {
      if (mode === "create") {
        if (insertMode === "overwrite") {
          editor.commands.clearContent();
        }
        let accumulatedContent = "";
        abortRef.current = await creatorGenerate(
          {
            files, prompt: userPrompt, template: template || undefined, pageId, insertMode,
            existingContentSummary: pageHasContent
              ? editor.state.doc.textBetween(0, Math.min(500, editor.state.doc.content.size))
              : undefined,
            pageTitle,
          },
          (chunk) => { accumulatedContent += chunk.content; updateLastMessage(() => accumulatedContent); },
          (error) => { notifications.show({ color: "red", message: error.error }); setIsStreaming(false); },
          () => {
            if (accumulatedContent) {
              // Extract first H1 as page title if title is empty
              let markdown = accumulatedContent;
              const titleMatch = markdown.match(/^#\s+(.+)$/m);
              if (titleMatch && titleEditor) {
                const currentTitle = titleEditor.state.doc.textContent.trim();
                if (!currentTitle) {
                  titleEditor.commands.setContent(titleMatch[1].trim());
                  // Remove the H1 line from body content
                  markdown = markdown.replace(/^#\s+.+\n*/m, '').trim();
                }
              }
              const html = (marked.parse(markdown) as string).trim();
              if (html) {
                editor.chain().focus("end").insertContent(html).run();
              }
            }
            setIsStreaming(false); setFiles([]);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            updateLastMessage((c) => c + `\n\n---\n*${elapsed}s*`);
          },
        );
      } else if (mode === "edit") {
        let accumulatedContent = "";
        const range = selectionRange;
        abortRef.current = await generateAiContentStream(
          { action: AiAction.CUSTOM, content: selection, prompt: userPrompt },
          (chunk) => { accumulatedContent += chunk.content; updateLastMessage(() => accumulatedContent); },
          (error) => { notifications.show({ color: "red", message: error.error }); setIsStreaming(false); },
          () => {
            if (accumulatedContent && range) {
              const html = (marked.parse(accumulatedContent) as string).trim();
              editor.chain().focus().setTextSelection(range).insertContent(html).run();
            }
            setIsStreaming(false);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            updateLastMessage((c) => c + `\n\n---\n*${elapsed}s*`);
          },
        );
      } else {
        abortRef.current = await generateAiContentStream(
          { action: AiAction.CUSTOM, content: selection, prompt: userPrompt },
          (chunk) => { updateLastMessage((prev) => prev + chunk.content); },
          (error) => { notifications.show({ color: "red", message: error.error }); setIsStreaming(false); },
          () => {
            setIsStreaming(false);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            updateLastMessage((c) => c + `\n\n---\n*${elapsed}s*`);
          },
        );
      }
    } catch (error: any) {
      notifications.show({ color: "red", message: error.message });
      setIsStreaming(false);
    }
  };

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    autoResize();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  return (
    <div className={classes.inputArea}>
      {/* File chips - create mode only */}
      {mode === "create" && <AiCreatorFileList />}

      {/* Template selector - create mode only */}
      {mode === "create" && <AiCreatorTemplates />}

      {/* Input row */}
      <div className={classes.inputRow}>
        {mode === "create" && (
          <>
            <Tooltip label={t("Upload files")} openDelay={300}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="md"
                onClick={handleFileUpload}
                disabled={isStreaming || files.length >= MAX_FILES}
              >
                <IconPaperclip size={18} stroke={1.8} />
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
          </>
        )}

        <div className={classes.inputWrapper}>
          <textarea
            ref={textareaRef}
            className={classes.inputTextarea}
            rows={1}
            placeholder={
              mode === "create"
                ? t("Describe what to create...")
                : mode === "edit"
                  ? t("Describe how to edit...")
                  : t("Ask about the selected text...")
            }
            value={prompt}
            onChange={handlePromptChange}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <ActionIcon variant="filled" color="red" radius="xl" size="sm" onClick={handleStop}>
              <IconPlayerStop size={14} />
            </ActionIcon>
          ) : (
            <ActionIcon
              variant="filled"
              color="blue"
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
  );
}
