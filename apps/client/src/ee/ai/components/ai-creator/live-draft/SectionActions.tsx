import { Group, Button, Text } from '@mantine/core';

interface SectionActionsProps {
  sectionId: string;
  sectionTitle: string;
  wordCount: number;
  onApprove?: (sectionId: string) => void;
  onRewrite?: (sectionId: string) => void;
}

export function SectionActions({ sectionId, sectionTitle, wordCount, onApprove, onRewrite }: SectionActionsProps) {
  return (
    <Group justify="space-between" p="xs" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
      <Text size="xs" c="dimmed">{sectionTitle} · {wordCount} 字</Text>
      <Group gap="xs">
        <Button size="compact-xs" variant="subtle" color="red" onClick={() => onRewrite?.(sectionId)}>
          重写本章
        </Button>
        <Button size="compact-xs" variant="light" onClick={() => onApprove?.(sectionId)}>
          满意 ✓
        </Button>
      </Group>
    </Group>
  );
}
