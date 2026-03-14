import { Stack, NavLink, Text } from '@mantine/core';

interface SectionNavItem {
  id: string;
  title: string;
  wordCount?: number;
  status: 'pending' | 'writing' | 'done' | 'error';
}

interface SectionNavProps {
  sections: SectionNavItem[];
  activeSectionId?: string;
  onSectionClick?: (sectionId: string) => void;
}

export function SectionNav({ sections, activeSectionId, onSectionClick }: SectionNavProps) {
  const statusIcon = (status: SectionNavItem['status']) => {
    switch (status) {
      case 'done': return '✅';
      case 'writing': return '✍️';
      case 'error': return '❌';
      default: return '⏳';
    }
  };

  return (
    <Stack gap={2}>
      <Text size="xs" fw={600} c="dimmed" mb={4}>章节导航</Text>
      {sections.map((section) => (
        <NavLink
          key={section.id}
          label={section.title}
          description={section.wordCount ? `${section.wordCount} 字` : undefined}
          leftSection={<Text size="xs">{statusIcon(section.status)}</Text>}
          active={section.id === activeSectionId}
          onClick={() => onSectionClick?.(section.id)}
          variant="subtle"
          styles={{ root: { padding: '4px 8px', borderRadius: 4 } }}
        />
      ))}
    </Stack>
  );
}
