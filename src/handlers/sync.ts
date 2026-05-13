import { apiCall } from "../lib/auth.js";
import { formatResponse } from "../lib/utils.js";
import { handleParseExcel } from "../lib/excel.js";
import { handleGenerateSyncPayload } from "../lib/payload.js";

export async function handleQueryTaskStats(args: Record<string, unknown>) {
  const userId = args.user_id as string;
  const projectId = args.project_id as string;

  const data = await apiCall(
    "GET", `/v1.0/project/users/${userId}/projectIds/${projectId}/tasks`, undefined, { maxResults: "200" }
  );

  const tasks = (data as { result: unknown[] }).result || [];
  const typeCounts: Record<string, number> = {};
  const priorityCounts: Record<number, number> = {};

  for (const t of tasks as Record<string, unknown>[]) {
    const content = (t.content as string) || "";
    const match = content.match(/^\[(\w+)\]/);
    const type = match ? match[1] : "unknown";
    typeCounts[type] = (typeCounts[type] || 0) + 1;

    const pri = (t.priority as number) || 0;
    priorityCounts[pri] = (priorityCounts[pri] || 0) + 1;
  }

  return formatResponse({
    total_tasks: tasks.length,
    type_summary: typeCounts,
    priority_summary: priorityCounts,
    sample_tasks: tasks.slice(0, 5).map((t: Record<string, unknown>) => ({
      content: t.content,
      priority: t.priority,
      is_done: t.isDone,
    })),
  });
}

// Re-export for server.ts
export { handleParseExcel, handleGenerateSyncPayload };
