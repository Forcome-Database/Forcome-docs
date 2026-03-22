import { useEffect, useRef, useState } from "react";
import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import {
  IconArrowUp,
  IconBrain,
  IconEdit,
  IconPaperclip,
  IconPencil,
  IconPencilOff,
  IconPlayerStop,
  IconPlus,
  IconRotate,
  IconTemplate,
  IconTrash,
} from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import {
  pageEditorAtom,
  titleEditorAtom,
} from "@/features/editor/atoms/editor-atoms";
import AiTemplateEditor from "@/ee/ai/components/ai-templates/ai-template-editor";
import {
  useAiTemplatesQuery,
  useDeleteAiTemplateMutation,
  useResetAiTemplateMutation,
} from "@/ee/ai/queries/ai-template-query";
import type { IAiTemplate } from "@/ee/ai/types/ai-template.types";
import type { AiCreateSessionSubmitParams } from "@/ee/ai/hooks/use-ai-create-session";
import {
  aiCreatorAutoInsertAtom,
  aiCreatorFilesAtom,
  aiCreatorSelectionAtom,
  aiCreatorSelectionRangeAtom,
  agentModeAtom,
  useTemplateAtom,
} from "./ai-creator-atoms";
import type { AiCreateSessionStatus } from "./ai-create-session.types";
import { AiCreatorFileList } from "./ai-creator-file-list";
import { AI_TEMPLATE_OPTIONS } from "./ai-creator.types";
import classes from "./ai-creator.module.css";

const ACCEPTED_FILES = ".pdf,.doc,.docx,.ppt,.pptx,.html,.png,.jpg,.jpeg";
const IMAGE_MIMETYPES = new Set(["image/png", "image/jpeg"]);
const MAX_FILES = 5;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

interface AiCreatorInputProps {
  isStreaming: boolean;
  status: AiCreateSessionStatus;
  onSubmit: (params: AiCreateSessionSubmitParams) => Promise<void>;
  onStop: () => void;
}

export function AiCreatorInput({
  isStreaming,
  status,
  onSubmit,
  onStop,
}: AiCreatorInputProps) {
  const { t } = useTranslation();
  const editor = useAtomValue(pageEditorAtom);
  const titleEditor = useAtomValue(titleEditorAtom);
  const [files, setFiles] = useAtom(aiCreatorFilesAtom);
  const [template, setTemplate] = useTemplateAtom();
  const selection = useAtomValue(aiCreatorSelectionAtom);
  const selectionRange = useAtomValue(aiCreatorSelectionRangeAtom);
  const [autoInsert, setAutoInsert] = useAtom(aiCreatorAutoInsertAtom);
  const [agentMode, setAgentMode] = useAtom(agentModeAtom);
  const [prompt, setPrompt] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousStatusRef = useRef<AiCreateSessionStatus>(status);

  const [userEditorOpened, setUserEditorOpened] = useState(false);
  const [editingUserTemplate, setEditingUserTemplate] = useState<IAiTemplate | null>(null);
  const resetMutation = useResetAiTemplateMutation();
  const deleteMutation = useDeleteAiTemplateMutation();
  const { data: dynamicTemplates } = useAiTemplatesQuery();

  const pageHasContent =
    editor && editor.state.doc.textContent.trim().length > 0;
  const pageTitle = titleEditor?.state.doc.textContent || "";

  useEffect(() => {
    if (previousStatusRef.current !== "completed" && status === "completed") {
      setFiles([]);
    }

    previousStatusRef.current = status;
  }, [setFiles, status]);

  const handleFileUpload = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    const validFiles = newFiles.filter((file) => {
      if (file.size > MAX_FILE_SIZE) {
        notifications.show({ color: "red", message: `${file.name} exceeds 20MB` });
        return false;
      }
      return true;
    });

    setFiles((prev) => [...prev, ...validFiles].slice(0, MAX_FILES));
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.files;
    if (!items || items.length === 0) {
      return;
    }

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const file = items[i];
      if (!IMAGE_MIMETYPES.has(file.type)) {
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        notifications.show({ color: "red", message: `${file.name} exceeds 20MB` });
        continue;
      }
      const name =
        file.name === "image.png" || file.name === ""
          ? `paste-${Date.now()}.${file.type.split("/")[1]}`
          : file.name;
      imageFiles.push(new File([file], name, { type: file.type }));
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      setFiles((prev) => [...prev, ...imageFiles].slice(0, MAX_FILES));
    }
  };

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }

    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    autoResize();
  };

  const handleSubmit = async () => {
    if (!prompt.trim() || isStreaming || !editor) {
      return;
    }

    const userPrompt = prompt.trim();
    setPrompt("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await onSubmit({
      prompt: userPrompt,
      files,
      template,
      selection,
      selectionRange,
      autoInsert,
      agentMode,
      pageHasContent,
      pageTitle,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const templateOptions = dynamicTemplates
    ? dynamicTemplates
    : AI_TEMPLATE_OPTIONS.map((tmpl) => ({
        key: tmpl.key,
        name: tmpl.name,
        prompt: "",
        scope: "system" as const,
        source: "system" as const,
        canReset: false,
        canEdit: false,
        canDelete: false,
        isDefault: true,
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
    if (!tmpl.id) {
      return;
    }

    try {
      await deleteMutation.mutateAsync({ templateId: tmpl.id });
      if (template === tmpl.key) {
        setTemplate(null);
      }
      notifications.show({ message: t("Template deleted"), color: "green" });
    } catch (error: any) {
      notifications.show({
        message: error?.response?.data?.message || t("Failed to delete"),
        color: "red",
      });
    }
  };

  const handleResetTemplate = async (key: string) => {
    try {
      await resetMutation.mutateAsync({ key });
      notifications.show({ message: t("Reset to default"), color: "green" });
    } catch (error: any) {
      notifications.show({
        message: error?.response?.data?.message || t("Failed to reset"),
        color: "red",
      });
    }
  };

  return (
    <div className={classes.inputArea}>
      <AiCreatorFileList />

      <div className={classes.inputBox}>
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

        <div className={classes.inputToolbar}>
          <div className={classes.inputToolbarLeft}>
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
                    style={template === tmpl.key ? { fontWeight: 600, color: "#6366f1" } : undefined}
                    rightSection={
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {tmpl.source === "user" && (
                          <span style={{ fontSize: 10, color: "#888" }}>{t("Personal")}</span>
                        )}
                        {tmpl.canReset && (
                          <Tooltip label={t("Reset to default")} openDelay={300}>
                            <ActionIcon
                              variant="subtle"
                              size="xs"
                              color="gray"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleResetTemplate(tmpl.key);
                              }}
                            >
                              <IconRotate size={12} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        {tmpl.canEdit && (
                          <Tooltip label={t("Edit")} openDelay={300}>
                            <ActionIcon
                              variant="subtle"
                              size="xs"
                              color="gray"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditTemplate(tmpl);
                              }}
                            >
                              <IconEdit size={12} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        {tmpl.canDelete && (
                          <Tooltip label={t("Delete")} openDelay={300}>
                            <ActionIcon
                              variant="subtle"
                              size="xs"
                              color="red"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDeleteTemplate(tmpl);
                              }}
                            >
                              <IconTrash size={12} />
                            </ActionIcon>
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

            <Tooltip
              label={
                autoInsert
                  ? t("Auto-insert ON: apply result to page after generation")
                  : t("Auto-insert OFF: keep draft in chat for manual insert")
              }
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

            <Tooltip
              label={
                agentMode
                  ? t("Deep mode ON: Agent researches before writing")
                  : t("Deep mode: Enable AI agent for research & multi-step generation")
              }
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

          <div className={classes.inputToolbarRight}>
            {isStreaming ? (
              <ActionIcon variant="filled" color="red" radius="xl" size="sm" onClick={onStop}>
                <IconPlayerStop size={14} />
              </ActionIcon>
            ) : (
              <ActionIcon
                variant="filled"
                color="indigo"
                radius="xl"
                size="sm"
                onClick={() => {
                  void handleSubmit();
                }}
                disabled={!prompt.trim()}
              >
                <IconArrowUp size={14} stroke={2.5} />
              </ActionIcon>
            )}
          </div>
        </div>
      </div>

      <AiTemplateEditor
        opened={userEditorOpened}
        onClose={() => setUserEditorOpened(false)}
        template={editingUserTemplate}
        scope={editingUserTemplate?.scope === "workspace" ? "workspace" : "user"}
      />
    </div>
  );
}
