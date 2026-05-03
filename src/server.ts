#!/usr/bin/env node
/**
 * DWS Teambition Plugin - MCP Stdio Server (v0.4.0)
 *
 * Wraps DingTalk Teambition Project Management APIs as MCP tools.
 * Auth: DWS_CLIENT_ID / DWS_CLIENT_SECRET environment variables.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Project & Org handlers
import * as project from "./handlers/project.js";
// Task CRUD + Updates
import * as tasks from "./handlers/tasks.js";
// Task types, workflow statuses, project stages
import * as types from "./handlers/types.js";
// Excel sync
import * as sync from "./handlers/sync.js";
// Browser payload generators (stage/type changes, sync)
import * as payload from "./lib/payload.js";

// ============================================================================
// Tool Definitions (compact to fit MCP buffer limits)
// ============================================================================

const S = (p: Record<string, unknown>, r: string[]) => ({ type: "object", properties: p, required: r });
const SS = (d: string) => ({ type: "string", description: d });
const NN = (d: string) => ({ type: "number", description: d });
const AA = (d: string) => ({ type: "array", items: { type: "string" }, description: d });

const TOOLS = [
  // === 28 TOOLS (DWS CLI display limit) ===

  // Excel Sync
  { name: "parse_excel", description: "解析 Excel 研发流程文件，自动分类",
    inputSchema: S({ file_path: SS("Excel 文件路径"), sheet_name: SS("工作表名") }, ["file_path"]) },
  { name: "generate_sync_payload", description: "生成浏览器批量创建任务的 JS 脚本",
    inputSchema: S({ tasks_json: SS("parse_excel 输出 JSON"), project_id: SS("项目 ID"), tasklist_id: SS("tasklistId"), stage_map_json: SS("stage ID 映射 JSON") }, ["tasks_json", "project_id", "tasklist_id", "stage_map_json"]) },

  // Tasklist & Stage (NEW - Browser API)
  { name: "generate_create_tasklist_payload", description: "创建任务组（含默认列）的浏览器脚本",
    inputSchema: S({ project_id: SS("项目 ID"), name: SS("任务组名称") }, ["project_id", "name"]) },
  { name: "generate_rename_stage_payload", description: "重命名阶段列的浏览器脚本",
    inputSchema: S({ stage_id: SS("stage ID"), new_name: SS("新名称") }, ["stage_id", "new_name"]) },
  { name: "generate_delete_tasklist_payload", description: "删除任务组（不可逆）的浏览器脚本",
    inputSchema: S({ tasklist_id: SS("tasklist ID") }, ["tasklist_id"]) },

  // Project & Org
  { name: "get_organization", description: "获取 Teambition 企业 Organization ID",
    inputSchema: S({ user_id: SS("钉钉 userId") }, ["user_id"]) },
  { name: "create_project", description: "创建新项目",
    inputSchema: S({ user_id: SS("userId"), name: SS("项目名称") }, ["user_id", "name"]) },
  { name: "get_project_members", description: "查询项目成员列表",
    inputSchema: S({ user_id: SS("userId"), project_id: SS("项目 ID"), max_results: NN("每页数量") }, ["user_id", "project_id"]) },
  { name: "add_project_members", description: "批量添加项目成员（最多10个）",
    inputSchema: S({ user_id: SS("userId"), project_id: SS("项目 ID"), member_user_ids: AA("用户 userId 列表") }, ["user_id", "project_id", "member_user_ids"]) },

  // Task CRUD
  { name: "create_task", description: "创建任务：支持标题/执行者/优先级/截止时间/备注/stageId/任务类型",
    inputSchema: S({ user_id: SS("userId"), project_id: SS("项目 ID"), content: SS("任务标题"),
      executor_id: SS("执行者 userId"), priority: NN("优先级"), due_date: SS("截止时间"), start_date: SS("开始时间"),
      note: SS("备注"), stage_id: SS("stage ID"), task_type_id: SS("scenariofieldconfigId"), parent_task_id: SS("父任务 ID"),
      participants: AA("参与者"), custom_fields: { type: "array", items: { type: "object", properties: { customfield_id: SS(""), customfield_name: SS(""), value: { type: "array", items: { type: "object", properties: { title: SS("") } } } } } },
    }, ["user_id", "project_id", "content"]) },
  { name: "get_task", description: "获取任务详情",
    inputSchema: S({ user_id: SS("userId"), task_id: SS("任务 ID"), parent_task_id: SS("父任务 ID") }, ["user_id"]) },
  { name: "query_tasks", description: "查询任务列表（TQL+分页）",
    inputSchema: S({ user_id: SS("userId"), project_id: SS("项目 ID"), query: SS("TQL"), max_results: NN("每页数量"), next_token: SS("分页游标") }, ["user_id", "project_id"]) },
  { name: "query_task_stats", description: "查询项目任务统计",
    inputSchema: S({ user_id: SS("userId"), project_id: SS("项目 ID") }, ["user_id", "project_id"]) },

  // Task Update (Granular)
  { name: "update_task_content", description: "更新任务标题",
    inputSchema: S({ user_id: SS("userId"), task_id: SS("任务 ID"), content: SS("新标题") }, ["user_id", "task_id", "content"]) },
  { name: "update_task_executor", description: "更新执行者",
    inputSchema: S({ user_id: SS("userId"), task_id: SS("任务 ID"), executor_id: SS("新执行者 userId") }, ["user_id", "task_id", "executor_id"]) },
  { name: "update_task_due_date", description: "更新截止时间",
    inputSchema: S({ user_id: SS("userId"), task_id: SS("任务 ID"), due_date: SS("ISO8601") }, ["user_id", "task_id", "due_date"]) },
  { name: "update_task_start_date", description: "更新开始时间",
    inputSchema: S({ user_id: SS("userId"), task_id: SS("任务 ID"), start_date: SS("ISO8601") }, ["user_id", "task_id", "start_date"]) },
  { name: "update_task_priority", description: "更新优先级",
    inputSchema: S({ user_id: SS("userId"), task_id: SS("任务 ID"), priority: NN("-10低 0普通 1紧急 2非常紧急") }, ["user_id", "task_id", "priority"]) },
  { name: "update_task_note", description: "更新备注",
    inputSchema: S({ user_id: SS("userId"), task_id: SS("任务 ID"), note: SS("新备注") }, ["user_id", "task_id", "note"]) },
  { name: "update_task_workflow_status", description: "更新工作流状态（可标记完成）",
    inputSchema: S({ user_id: SS("userId"), task_id: SS("任务 ID"), taskflow_status_id: SS("状态 ID"), note: SS("说明") }, ["user_id", "task_id", "taskflow_status_id"]) },
  { name: "update_task_custom_fields", description: "更新自定义字段",
    inputSchema: S({ user_id: SS("userId"), task_id: SS("任务 ID"), customfield_id: SS(""), customfield_name: SS(""),
      value: { type: "array", items: { type: "object", properties: { title: SS("") } } } }, ["user_id", "task_id", "value"]) },
  { name: "update_task_participants", description: "更新参与者",
    inputSchema: S({ user_id: SS("userId"), task_id: SS("任务 ID"), involve_members: AA("完整列表"), add_involvers: AA("添加"), del_involvers: AA("删除") }, ["user_id", "task_id"]) },
  { name: "update_task_batch", description: "批量更新任务多个字段",
    inputSchema: S({ user_id: SS("userId"), task_id: SS("任务 ID"), content: SS(""), executor_id: SS(""), due_date: SS(""), start_date: SS(""), priority: NN(""), note: SS(""), taskflow_status_id: SS("") }, ["user_id", "task_id"]) },

  // Stage & Type (Browser API)
  { name: "generate_move_task_stage_payload", description: "移动任务到不同 stage 的浏览器脚本",
    inputSchema: S({ task_id: SS("任务 ID"), project_id: SS("项目 ID"), target_stage_id: SS("目标 stage ID"), target_tasklist_id: SS("目标 tasklist ID") }, ["task_id", "project_id", "target_stage_id"]) },
  { name: "generate_change_task_type_payload", description: "修改任务类型的浏览器脚本",
    inputSchema: S({ task_id: SS("任务 ID"), project_id: SS("项目 ID"), template_id: SS("scenariofieldconfigId") }, ["task_id", "project_id", "template_id"]) },

  // Lifecycle
  { name: "archive_task", description: "归档任务", inputSchema: S({ user_id: SS("userId"), task_id: SS("任务 ID") }, ["user_id", "task_id"]) },
  { name: "delete_task", description: "永久删除任务", inputSchema: S({ user_id: SS("userId"), task_id: SS("任务 ID"), project_id: SS("项目 ID") }, ["user_id", "task_id", "project_id"]) },

  // Query Support
  { name: "query_task_workflow_statuses", description: "查询项目工作流状态",
    inputSchema: S({ user_id: SS("userId"), project_id: SS("项目 ID"), query: SS("模糊搜索") }, ["user_id", "project_id"]) },
  { name: "query_project_stages", description: "查询项目 stage 结构",
    inputSchema: S({ user_id: SS("userId"), project_id: SS("项目 ID") }, ["user_id", "project_id"]) },
];

// ============================================================================
// Handler Map
// ============================================================================

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  get_organization: project.handleGetOrganization,
  create_project: project.handleCreateProject,
  query_projects: project.handleQueryProjects,
  get_user_join_projects: project.handleGetUserJoinProjects,
  get_project_members: project.handleGetProjectMembers,
  add_project_members: project.handleAddProjectMembers,
  remove_project_members: project.handleRemoveProjectMembers,
  query_project_status: project.handleQueryProjectStatus,
  create_task: tasks.handleCreateTask,
  get_task: tasks.handleGetTask,
  query_tasks: tasks.handleQueryTasks,
  update_task_content: tasks.handleUpdateTaskContent,
  update_task_executor: tasks.handleUpdateTaskExecutor,
  update_task_due_date: tasks.handleUpdateTaskDueDate,
  update_task_start_date: tasks.handleUpdateTaskStartDate,
  update_task_priority: tasks.handleUpdateTaskPriority,
  update_task_note: tasks.handleUpdateTaskNote,
  update_task_workflow_status: tasks.handleUpdateTaskWorkflowStatus,
  update_task_custom_fields: tasks.handleUpdateTaskCustomFields,
  update_task_participants: tasks.handleUpdateTaskParticipants,
  update_task_batch: tasks.handleUpdateTaskBatch,
  generate_move_task_stage_payload: payload.handleGenerateMoveTaskStagePayload,
  generate_change_task_type_payload: payload.handleGenerateChangeTaskTypePayload,
  query_task_types: types.handleQueryTaskTypes,
  generate_query_task_types_payload: types.handleGenerateQueryTaskTypesPayload,
  generate_create_task_type_payload: types.handleGenerateCreateTaskTypePayload,
  generate_setup_standard_task_types_payload: types.handleGenerateSetupStandardTaskTypesPayload,
  archive_task: tasks.handleArchiveTask,
  delete_task: tasks.handleDeleteTask,
  query_task_workflow_statuses: types.handleQueryTaskWorkflowStatuses,
  query_project_stages: types.handleQueryProjectStages,
  parse_excel: sync.handleParseExcel,
  generate_sync_payload: sync.handleGenerateSyncPayload,
  query_task_stats: sync.handleQueryTaskStats,

  // Tasklist & Stage Management
  generate_create_tasklist_payload: payload.handleGenerateCreateTasklistPayload,
  generate_rename_stage_payload: payload.handleGenerateRenameStagePayload,
  generate_delete_tasklist_payload: payload.handleGenerateDeleteTasklistPayload,
  generate_batch_create_tasklists_payload: payload.handleGenerateBatchCreateTasklistsPayload,
};

// ============================================================================
// Server
// ============================================================================

const server = new Server(
  { name: "teambition", version: "0.4.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = HANDLERS[name];
  if (!handler) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    return await handler((args || {}) as Record<string, unknown>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
