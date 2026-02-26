import { Text } from "@mantine/core";
import { IconClipboard, IconArrowBarDown } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms";
import { notifications } from "@mantine/notifications";
import { AiCreatorMessage } from "./ai-creator.types";
import { marked } from "marked";
import { useTranslation } from "react-i18next";
import classes from "./ai-creator.module.css";

interface Props {
  message: AiCreatorMessage;
}

export function AiCreatorMessageItem({ message }: Props) {
  const { t } = useTranslation();
  const editor = useAtomValue(pageEditorAtom);
  const isUser = message.role === "user";

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    notifications.show({ message: t("Copied") });
  };

  const handleInsert = () => {
    if (!editor) return;
    const html = (marked.parse(message.content) as string).trim();
    editor.chain().focus().insertContent(html).run();
    notifications.show({ message: t("Inserted") });
  };

  if (isUser) {
    return (
      <div className={classes.messageUser}>
        <div className={classes.messageUserMeta}>
          <Text size="xs" fw={500} c="dimmed">{t("You")}</Text>
        </div>
        <div className={classes.messageUserBubble}>
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={classes.messageAi}>
      <div className={classes.messageAiMeta}>
        <Text size="xs" fw={500} c="dimmed">AI</Text>
      </div>
      <div className={classes.messageAiBubble}>
        <div
          className={classes.aiContent}
          dangerouslySetInnerHTML={{
            __html: marked.parse(message.content) as string,
          }}
        />
      </div>

      {message.mode === "chat" && message.content.length > 0 && (
        <div className={classes.messageActions}>
          <button className={classes.actionBtn} onClick={handleCopy}>
            <IconClipboard size={12} />
            {t("Copy")}
          </button>
          <button className={classes.actionBtn} onClick={handleInsert}>
            <IconArrowBarDown size={12} />
            {t("Insert to editor")}
          </button>
        </div>
      )}
    </div>
  );
}
