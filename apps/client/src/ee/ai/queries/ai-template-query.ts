import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listAiTemplates,
  createAiTemplate,
  updateAiTemplate,
  deleteAiTemplate,
  resetAiTemplate,
  getSystemPrompt,
  updateSystemPrompt,
} from "@/ee/ai/services/ai-template-service";
import {
  ICreateAiTemplate,
  IUpdateAiTemplate,
  IDeleteAiTemplate,
  IResetAiTemplate,
  IUpdateSystemPrompt,
} from "@/ee/ai/types/ai-template.types";

const TEMPLATES_KEY = ["ai-templates"];
const SYSTEM_PROMPT_KEY = ["ai-system-prompt"];

export function useAiTemplatesQuery() {
  return useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: async () => {
      const res = await listAiTemplates();
      return res.templates;
    },
    staleTime: 30_000,
  });
}

export function useSystemPromptQuery() {
  return useQuery({
    queryKey: SYSTEM_PROMPT_KEY,
    queryFn: async () => {
      const res = await getSystemPrompt();
      return res.systemPrompt;
    },
    staleTime: 30_000,
  });
}

export function useCreateAiTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ICreateAiTemplate) => createAiTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}

export function useUpdateAiTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: IUpdateAiTemplate) => updateAiTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}

export function useDeleteAiTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: IDeleteAiTemplate) => deleteAiTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}

export function useResetAiTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: IResetAiTemplate) => resetAiTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}

export function useUpdateSystemPromptMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: IUpdateSystemPrompt) => updateSystemPrompt(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SYSTEM_PROMPT_KEY });
    },
  });
}
