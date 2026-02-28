import api from "@/lib/api-client";
import { ITopic } from "@/features/topic/types/topic.types.ts";
import { IPagination, QueryParams } from "@/lib/types.ts";

export async function getTopics(
  directoryId: string,
  params?: QueryParams,
): Promise<IPagination<ITopic>> {
  const req = await api.post<IPagination<ITopic>>("/topics/list", {
    directoryId,
    ...params,
  });
  return req.data;
}

export async function getTopicById(topicId: string): Promise<ITopic> {
  const req = await api.post<ITopic>("/topics/info", { topicId });
  return req.data;
}

export async function createTopic(data: {
  name: string;
  description?: string;
  icon?: string;
  directoryId: string;
}): Promise<ITopic> {
  const req = await api.post<ITopic>("/topics/create", data);
  return req.data;
}

export async function updateTopic(data: {
  topicId: string;
  name?: string;
  description?: string;
  icon?: string;
}): Promise<ITopic> {
  const req = await api.post<ITopic>("/topics/update", data);
  return req.data;
}

export async function deleteTopic(topicId: string): Promise<void> {
  await api.post<void>("/topics/delete", { topicId });
}
