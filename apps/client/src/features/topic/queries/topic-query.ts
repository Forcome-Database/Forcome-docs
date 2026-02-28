import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
} from "@tanstack/react-query";
import { ITopic } from "@/features/topic/types/topic.types.ts";
import {
  createTopic,
  deleteTopic,
  getTopicById,
  getTopics,
  updateTopic,
} from "@/features/topic/services/topic-service.ts";
import { notifications } from "@mantine/notifications";
import { IPagination, QueryParams } from "@/lib/types.ts";
import { useTranslation } from "react-i18next";

export function useGetTopicsQuery(
  directoryId: string,
  params?: QueryParams,
): UseQueryResult<IPagination<ITopic>, Error> {
  return useQuery({
    queryKey: ["topics", directoryId, params],
    queryFn: () => getTopics(directoryId, params),
    enabled: !!directoryId,
    placeholderData: keepPreviousData,
  });
}

export function useTopicQuery(
  topicId: string,
): UseQueryResult<ITopic, Error> {
  return useQuery({
    queryKey: ["topic", topicId],
    queryFn: () => getTopicById(topicId),
    enabled: !!topicId,
  });
}

export function useCreateTopicMutation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<
    ITopic,
    Error,
    { name: string; description?: string; icon?: string; directoryId: string }
  >({
    mutationFn: (data) => createTopic(data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["topics", variables.directoryId],
      });
      notifications.show({ message: t("Topic created successfully") });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({
        message: errorMessage || t("Failed to create topic"),
        color: "red",
      });
    },
  });
}

export function useUpdateTopicMutation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<
    ITopic,
    Error,
    { topicId: string; name?: string; description?: string; icon?: string }
  >({
    mutationFn: (data) => updateTopic(data),
    onSuccess: (data) => {
      queryClient.setQueryData(["topic", data.id], data);
      queryClient.invalidateQueries({
        queryKey: ["topics", data.directoryId],
      });
      notifications.show({ message: t("Topic updated successfully") });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({
        message: errorMessage || t("Failed to update topic"),
        color: "red",
      });
    },
  });
}

export function useDeleteTopicMutation(directoryId?: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<void, Error, string>({
    mutationFn: (topicId) => deleteTopic(topicId),
    onSuccess: () => {
      if (directoryId) {
        queryClient.invalidateQueries({
          queryKey: ["topics", directoryId],
        });
      }
      notifications.show({ message: t("Topic deleted successfully") });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({
        message: errorMessage || t("Failed to delete topic"),
        color: "red",
      });
    },
  });
}
