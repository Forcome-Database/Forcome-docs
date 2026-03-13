import { useState } from 'react';
import { Button, Card, Group, Text, Textarea, Stack } from '@mantine/core';
import { IconCheck, IconSend } from '@tabler/icons-react';
import { AiCreatorMessage } from './ai-creator.types';
import type { AgentResumeValue } from '@/ee/ai/types/agent.types';
import classes from './ai-creator.module.css';

interface Props {
  message: AiCreatorMessage;
  onResume: (value: AgentResumeValue) => void;
}

export function AiCreatorProposeBubble({ message, onResume }: Props) {
  const proposals = message.proposals || [];
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');

  const handleSelect = (idx: number) => {
    setSelectedIdx(idx);
  };

  const handleConfirm = () => {
    if (selectedIdx === null) return;
    onResume({
      selected_proposal: selectedIdx,
      feedback: feedback.trim() || undefined,
    });
  };

  return (
    <div className={classes.messageAiBubble}>
      <Text size="sm" fw={500} mb="xs">请选择写作方案：</Text>
      <Stack gap="xs" mb="sm">
        {proposals.map((p, i) => (
          <Card
            key={i}
            padding="xs"
            radius="sm"
            withBorder
            style={{
              cursor: 'pointer',
              borderColor: selectedIdx === i ? 'var(--mantine-color-blue-5)' : undefined,
              backgroundColor: selectedIdx === i ? 'var(--mantine-color-blue-0)' : undefined,
            }}
            onClick={() => handleSelect(i)}
          >
            <Group gap="xs" justify="space-between">
              <div>
                <Text size="sm" fw={500}>{p.title}</Text>
                <Text size="xs" c="dimmed">{p.description}</Text>
              </div>
              {selectedIdx === i && <IconCheck size={16} color="var(--mantine-color-blue-5)" />}
            </Group>
          </Card>
        ))}
      </Stack>
      <Textarea
        placeholder="补充说明（可选）"
        value={feedback}
        onChange={(e) => setFeedback(e.currentTarget.value)}
        autosize
        minRows={1}
        maxRows={3}
      />
      <Button
        size="xs"
        mt="xs"
        leftSection={<IconSend size={14} />}
        onClick={handleConfirm}
        disabled={selectedIdx === null}
      >
        确认选择
      </Button>
    </div>
  );
}
