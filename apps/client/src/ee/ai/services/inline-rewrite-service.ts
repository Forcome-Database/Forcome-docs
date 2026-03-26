interface InlineRewriteRequest {
  selectionSnapshot: string;
  localContext: string;
  action: string;
  taskSummaryRef?: {
    summary: string;
    includeRawHistory: false;
  };
}

interface InlineRewriteResponse {
  candidate: string;
  riskFlags: string[];
  allowedActions: string[];
}

export async function rewriteInlineSelection(
  request: InlineRewriteRequest,
): Promise<InlineRewriteResponse> {
  const payload = {
    selectionSnapshot: request.selectionSnapshot,
    localContext: request.localContext,
    action: request.action,
    ...(request.taskSummaryRef
      ? {
          taskSummaryRef: request.taskSummaryRef,
        }
      : {}),
  };

  const response = await fetch("/api/ai/inline/rewrite", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Inline rewrite request failed: ${response.status}`);
  }

  const json = await response.json();
  return (json.data ?? json) as InlineRewriteResponse;
}
