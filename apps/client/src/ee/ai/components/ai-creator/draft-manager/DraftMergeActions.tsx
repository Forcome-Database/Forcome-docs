import { Group, Button, Text, Alert } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useState } from 'react';

interface DraftMergeActionsProps {
  onMerge: (mode: 'replace' | 'append') => void;
  onDiscard: () => void;
  hasExistingContent?: boolean;
}

export function DraftMergeActions({ onMerge, onDiscard, hasExistingContent }: DraftMergeActionsProps) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <Alert color="yellow" icon={<IconAlertCircle size={16} />}>
        <Text size="sm" mb="xs">确定要放弃此草稿吗？此操作不可撤销。</Text>
        <Group gap="xs">
          <Button size="xs" color="red" onClick={onDiscard}>确认放弃</Button>
          <Button size="xs" variant="subtle" onClick={() => setConfirming(false)}>取消</Button>
        </Group>
      </Alert>
    );
  }

  return (
    <Group justify="flex-end" gap="xs">
      <Button size="xs" variant="subtle" color="red" onClick={() => setConfirming(true)}>放弃草稿</Button>
      {hasExistingContent && (
        <Button size="xs" variant="light" onClick={() => onMerge('append')}>追加到页面</Button>
      )}
      <Button size="xs" onClick={() => onMerge('replace')}>
        {hasExistingContent ? '替换页面内容' : '写入页面'}
      </Button>
    </Group>
  );
}
