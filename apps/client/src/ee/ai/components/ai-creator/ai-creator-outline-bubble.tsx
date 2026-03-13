import { useState } from 'react';
import { Button, Group, Textarea } from '@mantine/core';
import { IconCheck, IconEdit, IconRefresh, IconX } from '@tabler/icons-react';
import { AiCreatorMessage } from './ai-creator.types';
import type { AgentResumeValue } from '@/ee/ai/types/agent.types';
import classes from './ai-creator.module.css';

// Create an ISOLATED marked instance for outline rendering
// This does NOT affect the global `marked` used by editor-ext's markdownToHtml
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const outlineMarked = new Marked();

function renderOutlineHtml(md: string): string {
  const raw = outlineMarked.parse(md) as string;
  return DOMPurify.sanitize(raw);
}

interface Props {
  message: AiCreatorMessage;
  onResume: (value: AgentResumeValue) => void;
}

export function AiCreatorOutlineBubble({ message, onResume }: Props) {
  const outline = message.outline || message.content || '';
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(outline);

  const handleConfirm = () => {
    onResume({
      action: 'confirm',
      confirmed_outline: isEditing ? editText : outline,
    });
  };

  const handleRegenerate = () => {
    onResume({ action: 'regenerate' });
  };

  const handleToggleEdit = () => {
    if (isEditing) {
      setIsEditing(false);
      setEditText(outline); // reset
    } else {
      setIsEditing(true);
      setEditText(outline);
    }
  };

  return (
    <div className={classes.messageAiBubble}>
      {isEditing ? (
        <Textarea
          value={editText}
          onChange={(e) => setEditText(e.currentTarget.value)}
          autosize
          minRows={6}
          maxRows={20}
          styles={{ input: { fontFamily: 'monospace', fontSize: '13px' } }}
        />
      ) : (
        <div
          className={classes.aiContent}
          dangerouslySetInnerHTML={{ __html: renderOutlineHtml(outline) }}
        />
      )}

      <Group mt="sm" gap="xs">
        <Button
          size="xs"
          variant="subtle"
          leftSection={isEditing ? <IconX size={14} /> : <IconEdit size={14} />}
          onClick={handleToggleEdit}
        >
          {isEditing ? '取消编辑' : '编辑大纲'}
        </Button>
        <Button
          size="xs"
          variant="filled"
          leftSection={<IconCheck size={14} />}
          onClick={handleConfirm}
        >
          确认生成
        </Button>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconRefresh size={14} />}
          onClick={handleRegenerate}
        >
          重新规划
        </Button>
      </Group>
    </div>
  );
}
