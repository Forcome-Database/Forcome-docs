import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
} from "@tanstack/react-query";
import { IDirectory } from "@/features/directory/types/directory.types.ts";
import {
  createDirectory,
  deleteDirectory,
  getDirectories,
  getDirectoryById,
  updateDirectory,
} from "@/features/directory/services/directory-service.ts";
import { notifications } from "@mantine/notifications";
import { IPagination, QueryParams } from "@/lib/types.ts";
import { useTranslation } from "react-i18next";

export function useGetDirectoriesQuery(
  spaceId: string,
  params?: QueryParams,
): UseQueryResult<IPagination<IDirectory>, Error> {
  return useQuery({
    queryKey: ["directories", spaceId, params],
    queryFn: () => getDirectories(spaceId, params),
    enabled: !!spaceId,
    placeholderData: keepPreviousData,
  });
}

export function useDirectoryQuery(
  directoryId: string,
): UseQueryResult<IDirectory, Error> {
  return useQuery({
    queryKey: ["directory", directoryId],
    queryFn: () => getDirectoryById(directoryId),
    enabled: !!directoryId,
  });
}

export function useCreateDirectoryMutation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<
    IDirectory,
    Error,
    { name: string; description?: string; icon?: string; spaceId: string }
  >({
    mutationFn: (data) => createDirectory(data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["directories", variables.spaceId],
      });
      notifications.show({ message: t("Directory created successfully") });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({
        message: errorMessage || t("Failed to create directory"),
        color: "red",
      });
    },
  });
}

export function useUpdateDirectoryMutation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<
    IDirectory,
    Error,
    { directoryId: string; name?: string; description?: string; icon?: string }
  >({
    mutationFn: (data) => updateDirectory(data),
    onSuccess: (data) => {
      queryClient.setQueryData(["directory", data.id], data);
      queryClient.invalidateQueries({
        queryKey: ["directories", data.spaceId],
      });
      notifications.show({ message: t("Directory updated successfully") });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({
        message: errorMessage || t("Failed to update directory"),
        color: "red",
      });
    },
  });
}

export function useDeleteDirectoryMutation(spaceId?: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<void, Error, string>({
    mutationFn: (directoryId) => deleteDirectory(directoryId),
    onSuccess: () => {
      if (spaceId) {
        queryClient.invalidateQueries({
          queryKey: ["directories", spaceId],
        });
      }
      notifications.show({ message: t("Directory deleted successfully") });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({
        message: errorMessage || t("Failed to delete directory"),
        color: "red",
      });
    },
  });
}
