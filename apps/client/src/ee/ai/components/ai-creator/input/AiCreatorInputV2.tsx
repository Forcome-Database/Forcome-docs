import { Textarea, Group, ActionIcon, Badge, Tooltip, Paper, Stack } from '@mantine/core';
import { IconSend, IconPaperclip, IconX } from '@tabler/icons-react';
import { useState, useRef, useCallback } from 'react';

interface AiCreatorInputV2Props {
  onSubmit: (message: string, files: File[]) => void;
  disabled?: boolean;
  complexityLevel?: number | null;
  placeholder?: string;
}

export function AiCreatorInputV2({ onSubmit, disabled, complexityLevel, placeholder }: AiCreatorInputV2Props) {
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(() => {
    if (!message.trim() && files.length === 0) return;
    onSubmit(message.trim(), files);
    setMessage('');
    setFiles([]);
  }, [message, files, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const levelColors: Record<number, string> = { 1: 'green', 2: 'yellow', 3: 'blue' };
  const levelLabels: Record<number, string> = { 1: 'L1 快速', 2: 'L2 确认', 3: 'L3 完整' };

  return (
    <Paper withBorder p="xs" radius="md">
      <Stack gap="xs">
        {files.length > 0 && (
          <Group gap="xs">
            {files.map((file, i) => (
              <Badge
                key={i}
                size="sm"
                variant="outline"
                rightSection={
                  <ActionIcon size="xs" variant="transparent" onClick={() => removeFile(i)}>
                    <IconX size={10} />
                  </ActionIcon>
                }
              >
                {file.name.length > 15 ? file.name.slice(0, 12) + '...' : file.name}
              </Badge>
            ))}
          </Group>
        )}

        <Group gap="xs" align="flex-end">
          <Tooltip label="上传文件">
            <ActionIcon
              size="sm"
              variant="subtle"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
            >
              <IconPaperclip size={16} />
            </ActionIcon>
          </Tooltip>

          <Textarea
            placeholder={placeholder || '描述你的需求...'}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            autosize
            minRows={1}
            maxRows={6}
            flex={1}
            size="sm"
            styles={{ input: { border: 'none', padding: '4px 0' } }}
          />

          {complexityLevel && (
            <Badge size="xs" color={levelColors[complexityLevel] || 'gray'} variant="light">
              {levelLabels[complexityLevel] || `L${complexityLevel}`}
            </Badge>
          )}

          <ActionIcon
            size="sm"
            variant="filled"
            color="blue"
            onClick={handleSubmit}
            disabled={disabled || (!message.trim() && files.length === 0)}
          >
            <IconSend size={14} />
          </ActionIcon>
        </Group>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
      </Stack>
    </Paper>
  );
}
