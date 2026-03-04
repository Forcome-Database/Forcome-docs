import { useState } from 'react';
import { Button, Textarea, Text, Stack } from '@mantine/core';
import { IconSend } from '@tabler/icons-react';
import { AiCreatorMessage } from './ai-creator.types';
import classes from './ai-creator.module.css';

interface Props {
  message: AiCreatorMessage;
  onResume: (value: Record<string, any>) => void;
}

export function AiCreatorClarifyBubble({ message, onResume }: Props) {
  const questions = message.questions || [];
  const [answer, setAnswer] = useState('');

  const handleSubmit = () => {
    if (!answer.trim()) return;
    onResume({ answers: answer.trim() });
  };

  return (
    <div className={classes.messageAiBubble}>
      <Text size="sm" fw={500} mb="xs">需要进一步了解：</Text>
      <Stack gap="xs" mb="sm">
        {questions.map((q, i) => (
          <Text key={i} size="sm" c="dimmed">
            {i + 1}. {q}
          </Text>
        ))}
      </Stack>
      <Textarea
        placeholder="请回答上述问题..."
        value={answer}
        onChange={(e) => setAnswer(e.currentTarget.value)}
        autosize
        minRows={2}
        maxRows={6}
      />
      <Button
        size="xs"
        mt="xs"
        leftSection={<IconSend size={14} />}
        onClick={handleSubmit}
        disabled={!answer.trim()}
      >
        提交回答
      </Button>
    </div>
  );
}
