import { useRef, useState, useCallback, type KeyboardEvent } from "react";
import { ActionIcon, Group, Textarea, Tooltip } from "@mantine/core";
import {
  IconArrowUp,
  IconPaperclip,
  IconPlayerStop,
  IconX,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import classes from "./agent-panel.module.css";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ACCEPTED = ".pdf,.doc,.docx,.ppt,.pptx,.html,.png,.jpg,.jpeg";

interface InputBarProps {
  onSubmit: (prompt: string, files?: File[]) => void;
  onCancel: () => void;
  isStreaming: boolean;
}

export function InputBar({ onSubmit, onCancel, isStreaming }: InputBarProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newFiles = Array.from(e.target.files ?? []);
      const valid = newFiles.filter((f) => {
        if (f.size > MAX_FILE_SIZE) {
          notifications.show({ message: t("{{name}} exceeds 20MB", { name: f.name }), color: "red" });
          return false;
        }
        return true;
      });
      setFiles((prev) => [...prev, ...valid].slice(0, MAX_FILES));
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [],
  );

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    const prompt = text.trim();
    if (!prompt && files.length === 0) return;
    onSubmit(prompt, files.length > 0 ? files : undefined);
    setText("");
    setFiles([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) handleSubmit();
    }
  };

  return (
    <div className={classes.inputBar}>
      <div className={classes.inputContainer}>
        {files.length > 0 && (
          <div className={classes.fileChips}>
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className={classes.fileChip}>
                {f.name}
                <IconX
                  size={11}
                  className={classes.fileChipClose}
                  onClick={() => removeFile(i)}
                />
              </span>
            ))}
          </div>
        )}
        <Group gap={4} align="flex-end">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <Tooltip label={t("Attach files")}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
            >
              <IconPaperclip size={16} />
            </ActionIcon>
          </Tooltip>
          <Textarea
            className={classes.inputTextarea}
            placeholder={t("Describe what to create...")}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            autosize
            minRows={1}
            maxRows={6}
            disabled={isStreaming}
            variant="unstyled"
          />
          {isStreaming ? (
            <Tooltip label={t("Stop")}>
              <ActionIcon
                variant="filled"
                color="red"
                size="sm"
                className={classes.stopButton}
                onClick={onCancel}
              >
                <IconPlayerStop size={14} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Tooltip label={t("Send")}>
              <ActionIcon
                size="sm"
                className={classes.sendButton}
                onClick={handleSubmit}
                disabled={!text.trim() && files.length === 0}
              >
                <IconArrowUp size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </div>
    </div>
  );
}
