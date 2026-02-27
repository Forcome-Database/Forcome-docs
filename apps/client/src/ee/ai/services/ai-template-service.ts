import api from "@/lib/api-client";
import {
  IAiTemplate,
  ICreateAiTemplate,
  IUpdateAiTemplate,
  IDeleteAiTemplate,
  IResetAiTemplate,
  IUpdateSystemPrompt,
} from "@/ee/ai/types/ai-template.types";

export async function listAiTemplates(): Promise<{ templates: IAiTemplate[] }> {
  const req = await api.post("/ai/templates/list");
  return req.data;
}

export async function createAiTemplate(
  data: ICreateAiTemplate,
): Promise<{ template: IAiTemplate }> {
  const req = await api.post("/ai/templates/create", data);
  return req.data;
}

export async function updateAiTemplate(
  data: IUpdateAiTemplate,
): Promise<{ template: IAiTemplate }> {
  const req = await api.post("/ai/templates/update", data);
  return req.data;
}

export async function deleteAiTemplate(
  data: IDeleteAiTemplate,
): Promise<{ success: boolean }> {
  const req = await api.post("/ai/templates/delete", data);
  return req.data;
}

export async function resetAiTemplate(
  data: IResetAiTemplate,
): Promise<{ success: boolean }> {
  const req = await api.post("/ai/templates/reset", data);
  return req.data;
}

export async function getSystemPrompt(): Promise<{ systemPrompt: string }> {
  const req = await api.post("/ai/templates/system-prompt");
  return req.data;
}

export async function updateSystemPrompt(
  data: IUpdateSystemPrompt,
): Promise<{ success: boolean }> {
  const req = await api.post("/ai/templates/system-prompt/update", data);
  return req.data;
}
