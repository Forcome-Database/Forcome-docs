import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
} from "@tanstack/react-query";
import { ResourcePermissionRecord } from "@/features/resource-permission/types/resource-permission.types";
import {
  addResourcePermission,
  listResourcePermissions,
  removeResourcePermission,
  updateResourcePermission,
} from "@/features/resource-permission/services/resource-permission-service";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";

export function useResourcePermissionsQuery(
  resourceType: string,
  resourceId: string,
): UseQueryResult<ResourcePermissionRecord[], Error> {
  return useQuery({
    queryKey: ["resource-permissions", resourceType, resourceId],
    queryFn: () => listResourcePermissions(resourceType, resourceId),
    enabled: !!resourceType && !!resourceId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAddResourcePermissionMutation(
  resourceType: string,
  resourceId: string,
) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<
    ResourcePermissionRecord,
    Error,
    {
      principalType: string;
      principalId: string;
      role: string;
    }
  >({
    mutationFn: (data) =>
      addResourcePermission({ resourceType, resourceId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["resource-permissions", resourceType, resourceId],
      });
      notifications.show({ message: t("Permission added successfully") });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({
        message: errorMessage || t("Failed to add permission"),
        color: "red",
      });
    },
  });
}

export function useUpdateResourcePermissionMutation(
  resourceType: string,
  resourceId: string,
) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<void, Error, { id: string; role: string }>({
    mutationFn: ({ id, role }) => updateResourcePermission(id, role),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["resource-permissions", resourceType, resourceId],
      });
      notifications.show({ message: t("Permission updated successfully") });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({
        message: errorMessage || t("Failed to update permission"),
        color: "red",
      });
    },
  });
}

export function useRemoveResourcePermissionMutation(
  resourceType: string,
  resourceId: string,
) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<void, Error, string>({
    mutationFn: (id) => removeResourcePermission(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["resource-permissions", resourceType, resourceId],
      });
      notifications.show({ message: t("Permission removed successfully") });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({
        message: errorMessage || t("Failed to remove permission"),
        color: "red",
      });
    },
  });
}
