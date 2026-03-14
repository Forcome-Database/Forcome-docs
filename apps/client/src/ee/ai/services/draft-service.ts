import api from "@/lib/api-client";

interface DraftParams {
  workspaceId: string;
  pageId: string;
  taskId: string;
}

export async function getDraft({ workspaceId, pageId, taskId }: DraftParams) {
  const resp = await api.post("/agent/draft/get", {
    workspace_id: workspaceId,
    page_id: pageId,
    task_id: taskId,
  });
  return resp.data;
}

export async function getMergedDraft({ workspaceId, pageId, taskId }: DraftParams) {
  const resp = await api.post("/agent/draft/merge", {
    workspace_id: workspaceId,
    page_id: pageId,
    task_id: taskId,
  });
  return resp.data;
}

export async function deleteDraft({ workspaceId, pageId, taskId }: DraftParams) {
  const resp = await api.post("/agent/draft/delete", {
    workspace_id: workspaceId,
    page_id: pageId,
    task_id: taskId,
  });
  return resp.data;
}
