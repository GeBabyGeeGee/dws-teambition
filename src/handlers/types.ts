import { apiCall } from "../lib/auth.js";
import { formatResponse } from "../lib/utils.js";
import {
  handleGenerateQueryTaskTypesPayload,
  handleGenerateCreateTaskTypePayload,
  handleGenerateSetupStandardTaskTypesPayload,
} from "./task-types-browser.js";

// ---- Task Type Management (DingTalk API) ----

export async function handleQueryTaskTypes(args: Record<string, unknown>) {
  const userId = args.user_id as string;
  const projectId = args.project_id as string;

  const data = await apiCall(
    "GET", `/v1.0/project/users/${userId}/projectIds/${projectId}/tasks`, undefined, { maxResults: "500" }
  );

  const tasks = (data as { result?: Record<string, unknown>[]; totalCount?: number }).result || [];
  const totalCount = (data as { totalCount?: number }).totalCount;

  const typeMap = new Map<string, { scenariofieldconfigId: string; count: number; sampleContents: string[]; doneCount: number }>();

  for (const t of tasks) {
    const sfcId = (t.scenariofieldconfigId as string) || "__default__";
    if (!typeMap.has(sfcId)) {
      typeMap.set(sfcId, { scenariofieldconfigId: sfcId, count: 0, sampleContents: [], doneCount: 0 });
    }
    const entry = typeMap.get(sfcId)!;
    entry.count++;
    if (t.isDone) entry.doneCount++;
    if (entry.sampleContents.length < 3) {
      entry.sampleContents.push(t.content as string);
    }
  }

  return formatResponse({
    project_id: projectId,
    total_tasks_sampled: tasks.length,
    total_tasks_in_project: totalCount,
    distinct_task_types: typeMap.size,
    task_types: Array.from(typeMap.values()).map((t) => ({
      scenariofieldconfigId: t.scenariofieldconfigId === "__default__" ? null : t.scenariofieldconfigId,
      task_count: t.count,
      done_count: t.doneCount,
      pending_count: t.count - t.doneCount,
      sample_contents: t.sampleContents,
      note: t.scenariofieldconfigId === "__default__"
        ? "Tasks without explicit type (using project default)"
        : "Use this scenariofieldconfigId in create_task or update via generate_change_task_type_payload",
    })),
    next_step: "For full task type details (name, icon, custom fields), use generate_query_task_types_payload.",
  });
}

// ---- Workflow Statuses ----

export async function handleQueryTaskWorkflowStatuses(args: Record<string, unknown>) {
  const userId = args.user_id as string;
  const projectId = args.project_id as string;
  const query = args.query as string | undefined;

  const params: Record<string, string> = { maxResults: "300" };
  if (query) params.query = query;

  const data = await apiCall(
    "GET", `/v1.0/project/users/${userId}/projects/${projectId}/taskflowStatuses/search`, undefined, params
  );

  const statuses = (data as { result?: Record<string, unknown>[] }).result || [];
  const byTaskflow = new Map<string, Record<string, unknown>[]>();
  for (const s of statuses) {
    const tfId = (s.taskflowId as string) || "__unknown__";
    if (!byTaskflow.has(tfId)) byTaskflow.set(tfId, []);
    byTaskflow.get(tfId)!.push(s);
  }

  return formatResponse({
    project_id: projectId,
    total_statuses: statuses.length,
    workflow_count: byTaskflow.size,
    workflows: Array.from(byTaskflow.entries()).map(([taskflowId, list]) => ({
      taskflow_id: taskflowId,
      status_count: list.length,
      statuses: list
        .sort((a, b) => ((a.pos as number) || 0) - ((b.pos as number) || 0))
        .map((s) => ({
          taskflow_status_id: s.taskflowStatusId,
          name: s.name,
          kind: s.kind,
          pos: s.pos,
          is_start: s.kind === "start",
          is_end: s.kind === "end",
        })),
    })),
    usage: 'Use update_task_workflow_status with kind="end" status to mark task done.',
  });
}

// ---- Project Stages (aggregated from tasks) ----

export async function handleQueryProjectStages(args: Record<string, unknown>) {
  const userId = args.user_id as string;
  const projectId = args.project_id as string;

  const data = await apiCall(
    "GET", `/v1.0/project/users/${userId}/projectIds/${projectId}/tasks`, undefined, { maxResults: "200" }
  );

  const tasks = (data as { result?: Record<string, unknown>[] }).result || [];
  const stageMap = new Map<string, { stageId: string; count: number; isDoneCount: number; sampleContent: string }>();
  for (const t of tasks) {
    const sid = (t.stageId as string) || "__uncategorized__";
    if (!stageMap.has(sid)) {
      stageMap.set(sid, { stageId: sid, count: 0, isDoneCount: 0, sampleContent: t.content as string });
    }
    const entry = stageMap.get(sid)!;
    entry.count++;
    if (t.isDone) entry.isDoneCount++;
  }

  return formatResponse({
    project_id: projectId,
    total_tasks: tasks.length,
    stage_count: stageMap.size,
    stages: Array.from(stageMap.entries()).map(([k, v]) => ({
      stage_id: k,
      task_count: v.count,
      done_count: v.isDoneCount,
      pending_count: v.count - v.isDoneCount,
      sample_task: v.sampleContent,
    })),
  });
}

// Re-export browser task-type handlers
export {
  handleGenerateQueryTaskTypesPayload,
  handleGenerateCreateTaskTypePayload,
  handleGenerateSetupStandardTaskTypesPayload,
};
