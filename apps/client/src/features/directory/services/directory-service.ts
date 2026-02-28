import api from "@/lib/api-client";
import { IDirectory } from "@/features/directory/types/directory.types.ts";
import { IPagination, QueryParams } from "@/lib/types.ts";

export async function getDirectories(
  spaceId: string,
  params?: QueryParams,
): Promise<IPagination<IDirectory>> {
  const req = await api.post<IPagination<IDirectory>>("/directories/list", {
    spaceId,
    ...params,
  });
  return req.data;
}

export async function getDirectoryById(
  directoryId: string,
): Promise<IDirectory> {
  const req = await api.post<IDirectory>("/directories/info", { directoryId });
  return req.data;
}

export async function createDirectory(data: {
  name: string;
  description?: string;
  icon?: string;
  spaceId: string;
}): Promise<IDirectory> {
  const req = await api.post<IDirectory>("/directories/create", data);
  return req.data;
}

export async function updateDirectory(data: {
  directoryId: string;
  name?: string;
  description?: string;
  icon?: string;
}): Promise<IDirectory> {
  const req = await api.post<IDirectory>("/directories/update", data);
  return req.data;
}

export async function deleteDirectory(directoryId: string): Promise<void> {
  await api.post<void>("/directories/delete", { directoryId });
}
