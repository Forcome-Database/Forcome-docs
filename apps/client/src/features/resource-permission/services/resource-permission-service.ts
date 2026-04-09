import api from "@/lib/api-client";
import { ResourcePermissionRecord } from "@/features/resource-permission/types/resource-permission.types";

export async function listResourcePermissions(
  resourceType: string,
  resourceId: string,
): Promise<ResourcePermissionRecord[]> {
  const res = await api.post<ResourcePermissionRecord[]>(
    "/resource-permissions/list",
    { resourceType, resourceId },
  );
  return res.data;
}

export async function addResourcePermission(data: {
  resourceType: string;
  resourceId: string;
  principalType: string;
  principalId: string;
  role: string;
}): Promise<ResourcePermissionRecord> {
  const res = await api.post<ResourcePermissionRecord>(
    "/resource-permissions/add",
    data,
  );
  return res.data;
}

export async function updateResourcePermission(
  id: string,
  role: string,
): Promise<void> {
  await api.post<void>("/resource-permissions/update", { id, role });
}

export async function removeResourcePermission(id: string): Promise<void> {
  await api.post<void>("/resource-permissions/remove", { id });
}
