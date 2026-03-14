import { Paper, Text, Stack, ScrollArea, Button, Group, Divider } from '@mantine/core';

interface DraftPanelProps {
  content: string;
  wordCount?: number;
  onMerge?: () => void;
  onDiscard?: () => void;
  showActions?: boolean;
}

export function DraftPanel({ content, wordCount, onMerge, onDiscard, showActions = true }: DraftPanelProps) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600} size="sm">📄 草稿预览</Text>
          {wordCount !== undefined && (
            <Text size="xs" c="dimmed">{wordCount} 字</Text>
          )}
        </Group>
        <Divider />
        <ScrollArea h={300}>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{content || '暂无内容'}</Text>
        </ScrollArea>
        {showActions && (
          <>
            <Divider />
            <Group justify="flex-end">
              {onDiscard && (
                <Button size="xs" variant="subtle" color="red" onClick={onDiscard}>放弃草稿</Button>
              )}
              {onMerge && (
                <Button size="xs" onClick={onMerge}>合并到页面</Button>
              )}
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}
