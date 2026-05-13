import { apiCall } from "../lib/auth.js";
import { formatResponse, errorResponse } from "../lib/utils.js";

// ---- Task CRUD ----

export async function handleCreateTask(args: Record<string, unknown>) {
  const body: Record<string, unknown> = { content: args.content, projectId: args.project_id };
  if (args.executor_id !== undefined) body.executorId = args.executor_id;
  if (args.priority !== undefined) body.priority = args.priority;
  if (args.due_date) body.dueDate = args.due_date;
  if (args.start_date) body.startDate = args.start_date;
  if (args.note) body.note = args.note;
  if (args.stage_id) body.stageId = args.stage_id;
  if (args.task_type_id) body.scenariofieldconfigId = args.task_type_id;
  if (args.parent_task_id) body.parentTaskId = args.parent_task_id;
  if (args.participants) body.involveMembers = args.participants;
  if (args.custom_fields) body.customfields = args.custom_fields;

  const data = await apiCall("POST", `/v1.0/project/users/${args.user_id}/tasks`, body);
  return formatResponse(data);
}

export async function handleGetTask(args: Record<string, unknown>) {
  const userId = args.user_id as string;
  const taskId = args.task_id as string | undefined;
  const parentTaskId = args.parent_task_id as string | undefined;

  if (!taskId && !parentTaskId) {
    return errorResponse("Either task_id or parent_task_id is required");
  }

  const params: Record<string, string> = {};
  if (taskId) params.taskId = taskId;
  if (parentTaskId) params.parentTaskId = parentTaskId;

  const data = await apiCall("GET", `/v1.0/project/users/${userId}/tasks`, undefined, params);

  const tasks = (data as { result?: unknown[] }).result || [];
  if (tasks.length === 0) {
    return errorResponse(`Task not found: ${taskId || parentTaskId}`);
  }
  if (taskId && !taskId.includes(",")) {
    return formatResponse(tasks[0]);
  }
  return formatResponse({ count: tasks.length, tasks });
}

export async function handleQueryTasks(args: Record<string, unknown>) {
  const params: Record<string, string> = {};
  if (args.query) params.query = args.query as string;
  if (args.next_token) params.nextToken = args.next_token as string;
  if (args.max_results) params.maxResults = String(args.max_results);
  else params.maxResults = "50";

  const data = await apiCall(
    "GET", `/v1.0/project/users/${args.user_id}/projectIds/${args.project_id}/tasks`, undefined, params
  );
  return formatResponse(data);
}

export async function handleArchiveTask(args: Record<string, unknown>) {
  const data = await apiCall("POST", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/archive`, {});
  return formatResponse(data);
}

export async function handleDeleteTask(args: Record<string, unknown>) {
  const data = await apiCall("DELETE", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}`, undefined, {
    projectId: args.project_id as string,
  });
  return formatResponse(data);
}

// ---- Granular Task Updates ----

export async function handleUpdateTaskContent(args: Record<string, unknown>) {
  const data = await apiCall(
    "PUT", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/contents`, { content: args.content }
  );
  return formatResponse(data);
}

export async function handleUpdateTaskExecutor(args: Record<string, unknown>) {
  const data = await apiCall(
    "PUT", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/executors`, { executorId: args.executor_id }
  );
  return formatResponse(data);
}

export async function handleUpdateTaskDueDate(args: Record<string, unknown>) {
  const data = await apiCall(
    "PUT", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/dueDates`, { dueDate: args.due_date }
  );
  return formatResponse(data);
}

export async function handleUpdateTaskStartDate(args: Record<string, unknown>) {
  const data = await apiCall(
    "PUT", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/startDates`, { startDate: args.start_date }
  );
  return formatResponse(data);
}

export async function handleUpdateTaskPriority(args: Record<string, unknown>) {
  const data = await apiCall(
    "PUT", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/priorities`, { priority: args.priority }
  );
  return formatResponse(data);
}

export async function handleUpdateTaskNote(args: Record<string, unknown>) {
  const data = await apiCall(
    "PUT", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/notes`, { note: args.note }
  );
  return formatResponse(data);
}

export async function handleUpdateTaskWorkflowStatus(args: Record<string, unknown>) {
  const body: Record<string, unknown> = { taskflowStatusId: args.taskflow_status_id };
  if (args.note) body.tfsUpdateNote = args.note;
  const data = await apiCall(
    "PUT", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/taskflowStatuses`, body
  );
  return formatResponse(data);
}

export async function handleUpdateTaskCustomFields(args: Record<string, unknown>) {
  const body: Record<string, unknown> = { value: args.value };
  if (args.customfield_id) body.customfieldId = args.customfield_id;
  if (args.customfield_name) body.customfieldName = args.customfield_name;
  const data = await apiCall(
    "PUT", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/customFields`, body
  );
  return formatResponse(data);
}

export async function handleUpdateTaskParticipants(args: Record<string, unknown>) {
  const body: Record<string, unknown> = {};
  if (args.involve_members) body.involveMembers = args.involve_members;
  if (args.add_involvers) body.addInvolvers = args.add_involvers;
  if (args.del_involvers) body.delInvolvers = args.del_involvers;
  const data = await apiCall(
    "PUT", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/involveMembers`, body
  );
  return formatResponse(data);
}

// ---- Batch Update ----

export async function handleUpdateTaskBatch(args: Record<string, unknown>) {
  const userId = args.user_id as string;
  const taskId = args.task_id as string;
  const results: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  type FieldUpdater = { field: string; handler: () => Promise<unknown> };
  const updates: FieldUpdater[] = [];

  if (args.content !== undefined) {
    updates.push({ field: "content", handler: () => handleUpdateTaskContent({ user_id: userId, task_id: taskId, content: args.content }) });
  }
  if (args.executor_id !== undefined) {
    updates.push({ field: "executor_id", handler: () => handleUpdateTaskExecutor({ user_id: userId, task_id: taskId, executor_id: args.executor_id }) });
  }
  if (args.due_date !== undefined) {
    updates.push({ field: "due_date", handler: () => handleUpdateTaskDueDate({ user_id: userId, task_id: taskId, due_date: args.due_date }) });
  }
  if (args.start_date !== undefined) {
    updates.push({ field: "start_date", handler: () => handleUpdateTaskStartDate({ user_id: userId, task_id: taskId, start_date: args.start_date }) });
  }
  if (args.priority !== undefined) {
    updates.push({ field: "priority", handler: () => handleUpdateTaskPriority({ user_id: userId, task_id: taskId, priority: args.priority }) });
  }
  if (args.note !== undefined) {
    updates.push({ field: "note", handler: () => handleUpdateTaskNote({ user_id: userId, task_id: taskId, note: args.note }) });
  }
  if (args.taskflow_status_id !== undefined) {
    updates.push({ field: "taskflow_status_id", handler: () => handleUpdateTaskWorkflowStatus({ user_id: userId, task_id: taskId, taskflow_status_id: args.taskflow_status_id }) });
  }

  if (updates.length === 0) {
    return errorResponse("No update fields specified.");
  }

  for (const { field, handler } of updates) {
    try {
      results[field] = await handler();
    } catch (err: unknown) {
      errors[field] = err instanceof Error ? err.message : String(err);
    }
  }

  return formatResponse({
    task_id: taskId,
    updated_fields: Object.keys(results),
    results,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
    summary: `${Object.keys(results).length} fields updated, ${Object.keys(errors).length} failed`,
  });
}
