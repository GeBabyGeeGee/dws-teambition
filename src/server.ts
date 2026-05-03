#!/usr/bin/env node
/**
 * DWS Teambition Plugin - MCP Stdio Server (v0.3.0)
 *
 * Wraps DingTalk Teambition Project Management APIs as MCP tools.
 *
 * Supported workflows:
 *   1. Excel → Teambition reproducible sync (parse → create project → generate payload → verify)
 *   2. Full task lifecycle management (create, read, update, archive, delete)
 *   3. Browser API payload generation for stage/type changes
 *
 * Auth: Uses DWS_CLIENT_ID / DWS_CLIENT_SECRET environment variables.
 *
 * Note: Task stage movement and type (templateId) changes require Teambition browser API.
 *       DingTalk OpenAPI does NOT support stageId/templateId modification.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ============================================================================
// Configuration
// ============================================================================

const DINGTALK_API = "https://api.dingtalk.com";
const CLIENT_ID = process.env.DWS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DWS_CLIENT_SECRET || "";

// ============================================================================
// Token Cache
// ============================================================================

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "Missing DWS_CLIENT_ID or DWS_CLIENT_SECRET. Set them via:\n" +
        "  export DWS_CLIENT_ID=<AppKey>\n" +
        "  export DWS_CLIENT_SECRET=<AppSecret>"
    );
  }
  const res = await fetch(`${DINGTALK_API}/v1.0/oauth2/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey: CLIENT_ID, appSecret: CLIENT_SECRET }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to get access token: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { accessToken: string; expireIn: number };
  cachedToken = {
    token: data.accessToken,
    expiresAt: Date.now() + data.expireIn * 1000,
  };
  return cachedToken.token;
}

async function apiCall(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>
): Promise<unknown> {
  const token = await getAccessToken();
  let url = `${DINGTALK_API}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += `?${qs}`;
  }
  const res = await fetch(url, {
    method,
    headers: {
      "x-acs-dingtalk-access-token": token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }
  return JSON.parse(text);
}

// ============================================================================
// Excel Parsing Logic
// ============================================================================

interface TaskItem {
  sn: number;
  content: string;
  priority: number;
  note: string;
  type: string;
}

function classifyDeliverable(deliverable: string, isKeyNode: boolean): string {
  if (deliverable.includes("风险") || deliverable.includes("评估")) return "risk";
  if (deliverable.includes("合同") || deliverable.includes("协议") || deliverable.includes("专利")) return "legal";
  if (deliverable.includes("变更") || deliverable.includes("ECR")) return "change";
  if (isKeyNode && (deliverable.includes("评审") || deliverable.includes("确认") || deliverable.includes("签样") || deliverable.includes("报告"))) return "milestone";
  if (isKeyNode) return "milestone";
  if (deliverable.includes("设计") || deliverable.includes("图") || deliverable.includes("方案") || deliverable.includes("效果图") || deliverable.includes("原理图")) return "design";
  if (deliverable.includes("测试") || deliverable.includes("检验") || deliverable.includes("验证") || deliverable.includes("认证")) return "qaqc";
  if (deliverable.includes("整改") || deliverable.includes("改善")) return "improve";
  if (deliverable.includes("需求") || deliverable.includes("要求") || deliverable.includes("立项") || deliverable.includes("需求书")) return "requirement";
  return "task";
}

function parseExcelRows(rows: string[][]): TaskItem[] {
  const prefixes: Record<string, string> = {
    milestone: "[milestone] ", risk: "[risk] ", design: "[design] ", qaqc: "[qaqc] ",
    requirement: "[requirement] ", legal: "[legal] ", change: "[change] ", improve: "[improve] ", task: "[task] ",
  };
  const priorities: Record<string, number> = {
    milestone: 2, risk: 2, change: 1, qaqc: 1, design: 0, requirement: 0, legal: 0, improve: 0, task: -10,
  };

  const tasks: TaskItem[] = [];
  let currentSn = 0;
  let currentStage = "";

  for (const row of rows) {
    const [num, stage, inDept, inReq, outDept, owner, reviewer, deliverable, keyNode, notes] = row;

    if (num && /^\d+$/.test(num)) {
      currentSn = parseInt(num);
      currentStage = `${num}.${stage}`;
      tasks.push({
        sn: currentSn,
        content: `[milestone] ${currentStage}`,
        priority: 2,
        note: `Stage: ${currentStage}`,
        type: "milestone",
      });
    }

    if (deliverable && deliverable.trim()) {
      const type = classifyDeliverable(deliverable, keyNode === "√");
      const np: string[] = [];
      if (inDept) np.push(`Input Dept: ${inDept}`);
      if (inReq) np.push(`Input: ${inReq}`);
      if (outDept) np.push(`Output Dept: ${outDept}`);
      if (owner) np.push(`Owner: ${owner}`);
      if (reviewer) np.push(`Reviewer: ${reviewer}`);
      if (keyNode === "√") np.push("KEY MILESTONE: Cannot proceed without passing");
      if (notes) np.push(`Note: ${notes}`);

      tasks.push({
        sn: currentSn,
        content: prefixes[type] + deliverable,
        priority: priorities[type],
        note: np.join("\n"),
        type,
      });
    }
  }

  return tasks;
}

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS = [
  // --- Project & Org ---
  {
    name: "get_organization",
    description: "获取当前用户的 Teambition 企业 (Organization) ID",
    inputSchema: {
      type: "object",
      properties: { user_id: { type: "string", description: "钉钉用户 userId" } },
      required: ["user_id"],
    },
  },
  {
    name: "create_project",
    description: "在 Teambition 中创建一个新项目",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        name: { type: "string", description: "项目名称" },
      },
      required: ["user_id", "name"],
    },
  },

  // --- Task CRUD ---
  {
    name: "create_task",
    description: "在指定项目中创建任务。支持设置：标题、执行者、优先级、截止时间、备注、自定义字段、stageId、开始时间、任务类型。",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        project_id: { type: "string", description: "项目 ID" },
        content: { type: "string", description: "任务标题" },
        executor_id: { type: "string", description: "执行者 userId（可选）" },
        priority: { type: "number", description: "优先级: -10=低, 0=普通, 1=紧急, 2=非常紧急（可选）" },
        due_date: { type: "string", description: "截止时间，ISO 8601 格式（可选）" },
        start_date: { type: "string", description: "开始时间，ISO 8601 格式（可选）" },
        note: { type: "string", description: "任务备注（可选）" },
        stage_id: { type: "string", description: "任务列表/stage ID（可选）" },
        task_type_id: { type: "string", description: "任务类型 ID / scenariofieldconfigId（可选）" },
        parent_task_id: { type: "string", description: "父任务 ID（可选）" },
        participants: { type: "array", items: { type: "string" }, description: "参与者 userId 列表（可选）" },
        custom_fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              customfield_id: { type: "string", description: "自定义字段 ID" },
              customfield_name: { type: "string", description: "自定义字段名称" },
              value: { type: "array", items: { type: "object", properties: { title: { type: "string" } } } },
            },
          },
          description: "自定义字段列表（可选）",
        },
      },
      required: ["user_id", "project_id", "content"],
    },
  },
  {
    name: "get_task",
    description: "获取单个或多个任务的详细信息（含 taskListId、taskStageId、scenarioFieldConfigId、customFields 等完整字段）。API: GET /v1.0/project/users/{userId}/tasks?taskId=...",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        task_id: { type: "string", description: "任务 ID（多个用逗号分隔）。与 parent_task_id 二选一" },
        parent_task_id: { type: "string", description: "父任务 ID（查询其所有子任务）。与 task_id 二选一" },
      },
      required: ["user_id"],
    },
  },
  {
    name: "query_tasks",
    description: "查询项目中的任务，支持 TQL 筛选、分页。返回完整任务字段（含 stageId、taskflowstatusId、scenariofieldconfigId 等）。",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        project_id: { type: "string", description: "项目 ID" },
        query: { type: "string", description: "TQL 查询条件（可选）" },
        max_results: { type: "number", description: "每页最大数量，默认 50，最大 500" },
        next_token: { type: "string", description: "分页游标（可选）" },
      },
      required: ["user_id", "project_id"],
    },
  },

  // --- Task Update (Granular - DingTalk OpenAPI) ---
  {
    name: "update_task_content",
    description: "更新任务标题（content）。API: PUT .../tasks/{taskId}/contents",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        task_id: { type: "string", description: "任务 ID" },
        content: { type: "string", description: "新的任务标题" },
      },
      required: ["user_id", "task_id", "content"],
    },
  },
  {
    name: "update_task_executor",
    description: "更新任务执行者。API: PUT .../tasks/{taskId}/executors",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        task_id: { type: "string", description: "任务 ID" },
        executor_id: { type: "string", description: "新的执行者 userId，传空字符串表示取消指派" },
      },
      required: ["user_id", "task_id", "executor_id"],
    },
  },
  {
    name: "update_task_due_date",
    description: "更新任务截止时间。API: PUT .../tasks/{taskId}/dueDates",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        task_id: { type: "string", description: "任务 ID" },
        due_date: { type: "string", description: "截止时间，ISO 8601 格式，例如 2026-07-04T18:00:00Z" },
      },
      required: ["user_id", "task_id", "due_date"],
    },
  },
  {
    name: "update_task_start_date",
    description: "更新任务开始时间。API: PUT .../tasks/{taskId}/startDates",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        task_id: { type: "string", description: "任务 ID" },
        start_date: { type: "string", description: "开始时间，ISO 8601 格式，例如 2026-07-01T09:00:00Z" },
      },
      required: ["user_id", "task_id", "start_date"],
    },
  },
  {
    name: "update_task_priority",
    description: "更新任务优先级。API: PUT .../tasks/{taskId}/priorities",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        task_id: { type: "string", description: "任务 ID" },
        priority: { type: "number", description: "优先级: -10=较低, 0=普通, 1=紧急, 2=非常紧急" },
      },
      required: ["user_id", "task_id", "priority"],
    },
  },
  {
    name: "update_task_note",
    description: "更新任务备注。API: PUT .../tasks/{taskId}/notes",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        task_id: { type: "string", description: "任务 ID" },
        note: { type: "string", description: "新的任务备注" },
      },
      required: ["user_id", "task_id", "note"],
    },
  },
  {
    name: "update_task_workflow_status",
    description: "更新任务工作流状态（可完成任务）。需先通过 query_task_workflow_statuses 获取目标状态 ID。API: PUT .../tasks/{taskId}/taskflowStatuses",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        task_id: { type: "string", description: "任务 ID" },
        taskflow_status_id: { type: "string", description: "目标工作流状态 ID" },
        note: { type: "string", description: "流转说明（可选）" },
      },
      required: ["user_id", "task_id", "taskflow_status_id"],
    },
  },
  {
    name: "update_task_custom_fields",
    description: "更新任务的自定义字段值。API: PUT .../tasks/{taskId}/customFields",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        task_id: { type: "string", description: "任务 ID" },
        customfield_id: { type: "string", description: "自定义字段 ID" },
        customfield_name: { type: "string", description: "自定义字段名称（可选，提供 ID 时忽略）" },
        value: {
          type: "array",
          items: { type: "object", properties: { title: { type: "string" } } },
          description: "自定义字段值列表",
        },
      },
      required: ["user_id", "task_id", "value"],
    },
  },
  {
    name: "update_task_participants",
    description: "更新任务参与者列表（增/删/替换）。API: PUT .../tasks/{taskId}/involveMembers",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        task_id: { type: "string", description: "任务 ID" },
        involve_members: { type: "array", items: { type: "string" }, description: "完整参与者列表（替换模式）" },
        add_involvers: { type: "array", items: { type: "string" }, description: "要添加的参与者（增量模式）" },
        del_involvers: { type: "array", items: { type: "string" }, description: "要删除的参与者（增量模式）" },
      },
      required: ["user_id", "task_id"],
    },
  },

  // --- Mass Update (Batch Apply) ---
  {
    name: "update_task_batch",
    description: "批量更新任务的多个字段。内部调用多个 granular API，支持：标题、执行者、截止时间、优先级、备注、工作流状态。不支持 stageId/模板类型变更（需浏览器 API）。",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        task_id: { type: "string", description: "任务 ID" },
        content: { type: "string", description: "新标题（可选）" },
        executor_id: { type: "string", description: "新执行者（可选）" },
        due_date: { type: "string", description: "新截止时间（可选）" },
        start_date: { type: "string", description: "新开始时间（可选）" },
        priority: { type: "number", description: "新优先级（可选）" },
        note: { type: "string", description: "新备注（可选）" },
        taskflow_status_id: { type: "string", description: "新工作流状态 ID（可选）" },
      },
      required: ["user_id", "task_id"],
    },
  },

  // --- Task Stage & Type (Browser API) ---
  {
    name: "generate_move_task_stage_payload",
    description: "生成移动任务到不同 stage 的浏览器 JS 脚本。用于将任务从一个任务列表移动到另一个（DingTalk OpenAPI 不支持此操作）。",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "要移动的任务 ID" },
        project_id: { type: "string", description: "项目 ID" },
        target_stage_id: { type: "string", description: "目标 stage/列表 ID" },
        target_tasklist_id: { type: "string", description: "目标 tasklist ID（可选，默认为原 tasklist）" },
      },
      required: ["task_id", "project_id", "target_stage_id"],
    },
  },
  {
    name: "generate_change_task_type_payload",
    description: "生成修改任务类型（模板）的浏览器 JS 脚本。用于更改任务的 scenariofieldconfigId/templateId（DingTalk OpenAPI 不支持此操作）。",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "任务 ID" },
        project_id: { type: "string", description: "项目 ID" },
        template_id: { type: "string", description: "目标任务类型/模板 ID (scenariofieldconfigId)" },
      },
      required: ["task_id", "project_id", "template_id"],
    },
  },

  // --- Task Type Management (定义任务类型) ---
  {
    name: "query_task_types",
    description: "查询项目中已有的任务类型（如 任务/需求/风险/审核 等）。通过聚合现有任务的 scenariofieldconfigId 推断。返回每个类型的 ID、样例任务及任务数量。",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        project_id: { type: "string", description: "项目 ID" },
      },
      required: ["user_id", "project_id"],
    },
  },
  {
    name: "generate_query_task_types_payload",
    description: "生成获取项目【完整】任务类型信息的浏览器 JS 脚本（含每个类型的名称、图标、自定义字段定义）。DingTalk OpenAPI 不暴露此信息，需用浏览器 API。",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "项目 ID" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "generate_create_task_type_payload",
    description: "生成创建新任务类型的浏览器 JS 脚本（DingTalk OpenAPI 不支持）。用于添加自定义类型如「需求」「风险」「审核」等。可选 base_template_id 复制已有类型的字段/工作流。",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "项目 ID" },
        name: { type: "string", description: "新任务类型名称，如「需求」「风险」「审核」" },
        icon: { type: "string", description: "图标名（可选，默认 task），如 task/bug/story/milestone" },
        base_template_id: { type: "string", description: "可选：基于现有任务类型复制（保留其字段/工作流配置）" },
      },
      required: ["project_id", "name"],
    },
  },
  {
    name: "generate_setup_standard_task_types_payload",
    description: "生成批量创建 9 种标准研发任务类型的浏览器 JS 脚本：任务/需求/风险/审核/设计/质量/合同/变更/改善。匹配 Excel 同步流程的分类系统。",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "项目 ID" },
        custom_types: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              icon: { type: "string" },
            },
            required: ["name"],
          },
          description: "可选：自定义类型列表覆盖默认 9 种。例如 [{name:'缺陷',icon:'bug'},{name:'需求',icon:'story'}]",
        },
      },
      required: ["project_id"],
    },
  },

  // --- Task Lifecycle ---
  {
    name: "archive_task",
    description: "归档任务（移动到回收站）",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        task_id: { type: "string", description: "任务 ID" },
      },
      required: ["user_id", "task_id"],
    },
  },
  {
    name: "delete_task",
    description: "永久删除任务",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        task_id: { type: "string", description: "任务 ID" },
        project_id: { type: "string", description: "所属项目 ID" },
      },
      required: ["user_id", "task_id", "project_id"],
    },
  },

  // --- Query Support ---
  {
    name: "query_task_workflow_statuses",
    description: "查询项目所有可用的工作流状态（含 ID、名称、kind=start|end|unset、pos）。返回按 taskflowId 分组。kind=\"end\" 的状态用于标记任务完成。API: GET .../projects/{pid}/taskflowStatuses/search",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        project_id: { type: "string", description: "项目 ID" },
        query: { type: "string", description: "可选：模糊匹配状态名称，如「已完成」「未开始」" },
      },
      required: ["user_id", "project_id"],
    },
  },
  {
    name: "query_project_stages",
    description: "查询项目中的任务列表/stage 结构（通过任务聚合），返回各 stage 及任务计数。用于了解项目结构。",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        project_id: { type: "string", description: "项目 ID" },
      },
      required: ["user_id", "project_id"],
    },
  },

  // --- Excel Sync ---
  {
    name: "parse_excel",
    description: "解析 Excel 研发流程文件，自动分类任务（milestone/risk/design/qaqc/legal/change/improve/requirement/task）。返回 JSON 格式任务列表。",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Excel 文件的绝对路径" },
        sheet_name: { type: "string", description: "工作表名称（可选，默认第一个sheet）" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "generate_sync_payload",
    description: "根据 parse_excel 输出生成浏览器批量创建 JS 脚本。用于 Teambition 浏览器端批量创建带 stage 分配的任务。",
    inputSchema: {
      type: "object",
      properties: {
        tasks_json: { type: "string", description: "parse_excel 输出的 JSON 字符串" },
        project_id: { type: "string", description: "Teambition 项目 ID" },
        tasklist_id: { type: "string", description: "Teambition 默认分组的 tasklistId" },
        stage_map_json: { type: "string", description: 'JSON mapping of stage numbers to stage IDs, e.g. {"1":"xxx","2":"yyy"}' },
      },
      required: ["tasks_json", "project_id", "tasklist_id", "stage_map_json"],
    },
  },
  {
    name: "query_task_stats",
    description: "查询项目各分组的任务统计，验证同步结果",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        project_id: { type: "string", description: "项目 ID" },
      },
      required: ["user_id", "project_id"],
    },
  },
];

// ============================================================================
// Handlers - Project & Org
// ============================================================================

async function handleGetOrganization(args: Record<string, unknown>) {
  const data = await apiCall("GET", "/v1.0/project/teambition/organizations", undefined, {
    optUserId: args.user_id as string,
  });
  return formatResponse(data);
}

async function handleCreateProject(args: Record<string, unknown>) {
  const data = await apiCall("POST", `/v1.0/project/users/${args.user_id}/projects`, { name: args.name });
  return formatResponse(data);
}

// ============================================================================
// Handlers - Task CRUD
// ============================================================================

async function handleCreateTask(args: Record<string, unknown>) {
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

async function handleGetTask(args: Record<string, unknown>) {
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
  // If single taskId requested, return the single task; if multiple/parent, return array
  if (taskId && !taskId.includes(",")) {
    return formatResponse(tasks[0]);
  }
  return formatResponse({ count: tasks.length, tasks });
}

async function handleQueryTasks(args: Record<string, unknown>) {
  const params: Record<string, string> = {};
  if (args.query) params.query = args.query as string;
  if (args.next_token) params.nextToken = args.next_token as string;
  if (args.max_results) params.maxResults = String(args.max_results);
  else params.maxResults = "50";

  const data = await apiCall(
    "GET",
    `/v1.0/project/users/${args.user_id}/projectIds/${args.project_id}/tasks`,
    undefined,
    params
  );
  // Return full response with totalCount + nextToken for pagination
  return formatResponse(data);
}

// ============================================================================
// Handlers - Task Update (Granular APIs)
// ============================================================================

async function handleUpdateTaskContent(args: Record<string, unknown>) {
  const data = await apiCall(
    "PUT",
    `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/contents`,
    { content: args.content }
  );
  return formatResponse(data);
}

async function handleUpdateTaskExecutor(args: Record<string, unknown>) {
  const data = await apiCall(
    "PUT",
    `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/executors`,
    { executorId: args.executor_id }
  );
  return formatResponse(data);
}

async function handleUpdateTaskDueDate(args: Record<string, unknown>) {
  const data = await apiCall(
    "PUT",
    `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/dueDates`,
    { dueDate: args.due_date }
  );
  return formatResponse(data);
}

async function handleUpdateTaskStartDate(args: Record<string, unknown>) {
  const data = await apiCall(
    "PUT",
    `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/startDates`,
    { startDate: args.start_date }
  );
  return formatResponse(data);
}

async function handleUpdateTaskPriority(args: Record<string, unknown>) {
  const data = await apiCall(
    "PUT",
    `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/priorities`,
    { priority: args.priority }
  );
  return formatResponse(data);
}

async function handleUpdateTaskNote(args: Record<string, unknown>) {
  const data = await apiCall(
    "PUT",
    `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/notes`,
    { note: args.note }
  );
  return formatResponse(data);
}

async function handleUpdateTaskWorkflowStatus(args: Record<string, unknown>) {
  const body: Record<string, unknown> = { taskflowStatusId: args.taskflow_status_id };
  if (args.note) body.tfsUpdateNote = args.note;
  const data = await apiCall(
    "PUT",
    `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/taskflowStatuses`,
    body
  );
  return formatResponse(data);
}

async function handleUpdateTaskCustomFields(args: Record<string, unknown>) {
  const body: Record<string, unknown> = { value: args.value };
  if (args.customfield_id) body.customfieldId = args.customfield_id;
  if (args.customfield_name) body.customfieldName = args.customfield_name;
  const data = await apiCall(
    "PUT",
    `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/customFields`,
    body
  );
  return formatResponse(data);
}

async function handleUpdateTaskParticipants(args: Record<string, unknown>) {
  const body: Record<string, unknown> = {};
  if (args.involve_members) body.involveMembers = args.involve_members;
  if (args.add_involvers) body.addInvolvers = args.add_involvers;
  if (args.del_involvers) body.delInvolvers = args.del_involvers;
  const data = await apiCall(
    "PUT",
    `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/involveMembers`,
    body
  );
  return formatResponse(data);
}

// ============================================================================
// Handler - Batch Update
// ============================================================================

async function handleUpdateTaskBatch(args: Record<string, unknown>) {
  const userId = args.user_id as string;
  const taskId = args.task_id as string;
  const results: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  type FieldUpdater = { field: string; handler: () => Promise<unknown> };
  const updates: FieldUpdater[] = [];

  if (args.content !== undefined) {
    updates.push({
      field: "content",
      handler: () => handleUpdateTaskContent({ user_id: userId, task_id: taskId, content: args.content }),
    });
  }
  if (args.executor_id !== undefined) {
    updates.push({
      field: "executor_id",
      handler: () => handleUpdateTaskExecutor({ user_id: userId, task_id: taskId, executor_id: args.executor_id }),
    });
  }
  if (args.due_date !== undefined) {
    updates.push({
      field: "due_date",
      handler: () => handleUpdateTaskDueDate({ user_id: userId, task_id: taskId, due_date: args.due_date }),
    });
  }
  if (args.start_date !== undefined) {
    updates.push({
      field: "start_date",
      handler: () => handleUpdateTaskStartDate({ user_id: userId, task_id: taskId, start_date: args.start_date }),
    });
  }
  if (args.priority !== undefined) {
    updates.push({
      field: "priority",
      handler: () => handleUpdateTaskPriority({ user_id: userId, task_id: taskId, priority: args.priority }),
    });
  }
  if (args.note !== undefined) {
    updates.push({
      field: "note",
      handler: () => handleUpdateTaskNote({ user_id: userId, task_id: taskId, note: args.note }),
    });
  }
  if (args.taskflow_status_id !== undefined) {
    updates.push({
      field: "taskflow_status_id",
      handler: () => handleUpdateTaskWorkflowStatus({ user_id: userId, task_id: taskId, taskflow_status_id: args.taskflow_status_id }),
    });
  }

  if (updates.length === 0) {
    return errorResponse("No update fields specified. Provide at least one of: content, executor_id, due_date, start_date, priority, note, taskflow_status_id");
  }

  // Execute sequentially to avoid race conditions
  for (const { field, handler } of updates) {
    try {
      const result = await handler();
      results[field] = result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors[field] = msg;
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

// ============================================================================
// Handlers - Task Stage & Type (Browser API)
// ============================================================================

async function handleGenerateMoveTaskStagePayload(args: Record<string, unknown>) {
  const taskId = args.task_id as string;
  const projectId = args.project_id as string;
  const targetStageId = args.target_stage_id as string;
  const tasklistId = (args.target_tasklist_id as string) || "";

  const jsPayload = `
// Copy-paste this into browser console (F12) while on Teambition project page
// Or use with Playwright page.evaluate()
// Moves task to a different stage/tasklist

(async () => {
  const TASK_ID = "${taskId}";
  const PROJECT_ID = "${projectId}";
  const TARGET_STAGE_ID = "${targetStageId}";
  const TASKLIST_ID = "${tasklistId}";

  const body = {
    _id: TASK_ID,
    _projectId: PROJECT_ID,
    _stageId: TARGET_STAGE_ID,
  };
  if (TASKLIST_ID) body._tasklistId = TASKLIST_ID;

  try {
    const res = await fetch("https://www.teambition.com/api/task/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log("Task moved:", data);
    return data;
  } catch (e) {
    console.error("Failed to move task:", e);
    return { error: e.message };
  }
})();
`;

  return formatResponse({
    instructions: "This is a browser-executable script. Use with Playwright page.evaluate() or paste into F12 console.",
    task_id: taskId,
    project_id: projectId,
    target_stage_id: targetStageId,
    js_payload: jsPayload,
  });
}

async function handleGenerateChangeTaskTypePayload(args: Record<string, unknown>) {
  const taskId = args.task_id as string;
  const projectId = args.project_id as string;
  const templateId = args.template_id as string;

  const jsPayload = `
// Copy-paste this into browser console (F12) while on Teambition project page
// Or use with Playwright page.evaluate()
// Changes task type/template

(async () => {
  const TASK_ID = "${taskId}";
  const PROJECT_ID = "${projectId}";
  const TEMPLATE_ID = "${templateId}";

  try {
    const res = await fetch("https://www.teambition.com/api/task/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        _id: TASK_ID,
        _projectId: PROJECT_ID,
        templateId: TEMPLATE_ID,
      }),
    });
    const data = await res.json();
    console.log("Task type changed:", data);
    return data;
  } catch (e) {
    console.error("Failed to change task type:", e);
    return { error: e.message };
  }
})();
`;

  return formatResponse({
    instructions: "This is a browser-executable script. Use with Playwright page.evaluate() or paste into F12 console.",
    task_id: taskId,
    project_id: projectId,
    template_id: templateId,
    js_payload: jsPayload,
  });
}

// ============================================================================
// Handlers - Task Type Management (定义任务类型)
// ============================================================================

async function handleQueryTaskTypes(args: Record<string, unknown>) {
  const userId = args.user_id as string;
  const projectId = args.project_id as string;

  // DingTalk OpenAPI doesn't expose task type list directly.
  // Aggregate from existing tasks' scenariofieldconfigId field.
  const data = await apiCall(
    "GET",
    `/v1.0/project/users/${userId}/projectIds/${projectId}/tasks`,
    undefined,
    { maxResults: "500" }
  );

  const tasks = (data as { result?: Record<string, unknown>[]; totalCount?: number }).result || [];
  const totalCount = (data as { totalCount?: number }).totalCount;

  // Aggregate by scenariofieldconfigId
  const typeMap = new Map<
    string,
    { scenariofieldconfigId: string; count: number; sampleContents: string[]; doneCount: number }
  >();

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
      note:
        t.scenariofieldconfigId === "__default__"
          ? "Tasks without explicit type (using project default)"
          : "Use this scenariofieldconfigId in create_task or update via generate_change_task_type_payload",
    })),
    next_step:
      "For full task type details (name, icon, custom fields), use generate_query_task_types_payload to get a browser API script.",
  });
}

async function handleGenerateQueryTaskTypesPayload(args: Record<string, unknown>) {
  const projectId = args.project_id as string;

  const jsPayload = `
// Copy-paste into browser console (F12) on Teambition project page
// Or use with Playwright page.evaluate()
// Returns full task type info: name, icon, custom fields, taskflow

(async () => {
  const PROJECT_ID = "${projectId}";
  try {
    const res = await fetch(\`/api/scenariofieldconfigs?_projectId=\${PROJECT_ID}&_objectType=task\`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    const types = Array.isArray(data) ? data : (data.result || []);
    const summary = types.map((t) => ({
      scenariofieldconfigId: t._id,
      name: t.name,
      icon: t.icon,
      isDefault: !!t.isDefault,
      taskflowId: t.taskflowId,
      proTemplateConfigType: t.proTemplateConfigType,
      customfieldCount: (t.customfields || []).length,
      customfields: (t.customfields || []).map((cf) => ({
        cfId: cf.cfId,
        fieldType: cf.fieldType,
        required: cf.required,
        displayed: cf.displayed,
      })),
    }));
    console.log("Task Types:", summary);
    return summary;
  } catch (e) {
    console.error("Failed:", e);
    return { error: e.message };
  }
})();
`;

  return formatResponse({
    instructions:
      "Browser-executable script. Run on Teambition while logged in. Returns full task type info including custom fields. Use with Playwright page.evaluate() or paste into F12 console.",
    project_id: projectId,
    js_payload: jsPayload,
    notes: [
      "Result includes scenariofieldconfigId (use as task_type_id when creating tasks)",
      "Each type's customfields array shows what fields belong to that type",
      "taskflowId can be used to query workflow statuses for that type",
    ],
  });
}

async function handleGenerateCreateTaskTypePayload(args: Record<string, unknown>) {
  const projectId = args.project_id as string;
  const name = args.name as string;
  const icon = (args.icon as string) || "task";
  const baseTemplateId = (args.base_template_id as string) || "";

  const jsPayload = `
// Copy-paste into browser console (F12) on Teambition project page
// Or use with Playwright page.evaluate()
// Creates a new task type (scenariofieldconfig)

(async () => {
  const PROJECT_ID = "${projectId}";
  const NAME = ${JSON.stringify(name)};
  const ICON = ${JSON.stringify(icon)};
  const BASE_ID = ${JSON.stringify(baseTemplateId)};

  try {
    // If baseTemplateId provided, fetch its config to copy fields/taskflow
    let body = {
      _projectId: PROJECT_ID,
      name: NAME,
      icon: ICON,
      objectType: "task",
    };

    if (BASE_ID) {
      const baseRes = await fetch(\`/api/scenariofieldconfigs/\${BASE_ID}\`);
      const baseData = await baseRes.json();
      body.taskflowId = baseData.taskflowId;
      body.customfields = baseData.customfields || [];
      body.proTemplateConfigType = baseData.proTemplateConfigType;
    }

    const res = await fetch("/api/scenariofieldconfigs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log("Task type created:", data);
    return {
      scenariofieldconfigId: data._id,
      name: data.name,
      icon: data.icon,
      taskflowId: data.taskflowId,
    };
  } catch (e) {
    console.error("Failed to create task type:", e);
    return { error: e.message };
  }
})();
`;

  return formatResponse({
    instructions:
      "Browser-executable script. Run on Teambition while logged in. Use with Playwright page.evaluate() or paste into F12 console.",
    project_id: projectId,
    name,
    icon,
    base_template_id: baseTemplateId || null,
    js_payload: jsPayload,
    notes: [
      "After creation, the new scenariofieldconfigId can be used in create_task / update task type operations",
      "If base_template_id is provided, the new type inherits its custom fields and workflow",
      "Common icons: task, bug, story, milestone, requirement, design, qaqc, risk",
      "After creating, run generate_query_task_types_payload to verify",
    ],
  });
}

async function handleGenerateSetupStandardTaskTypesPayload(args: Record<string, unknown>) {
  const projectId = args.project_id as string;
  const customTypes = args.custom_types as Array<{ name: string; icon?: string }> | undefined;

  // Default 9 R&D task types matching the Excel sync workflow classification
  const defaultTypes = [
    { name: "任务", icon: "task" },
    { name: "需求", icon: "story" },
    { name: "风险", icon: "risk" },
    { name: "审核", icon: "milestone" },
    { name: "设计", icon: "design" },
    { name: "质量", icon: "qaqc" },
    { name: "合同", icon: "legal" },
    { name: "变更", icon: "change" },
    { name: "改善", icon: "improve" },
  ];

  const types = customTypes && customTypes.length > 0 ? customTypes : defaultTypes;

  const jsPayload = `
// Copy-paste into browser console (F12) on Teambition project page
// Or use with Playwright page.evaluate()
// Creates standard R&D task types

(async () => {
  const PROJECT_ID = "${projectId}";
  const TYPES = ${JSON.stringify(types)};

  // First fetch existing types to detect duplicates and reuse default taskflowId
  let existingTypes = [];
  let defaultTaskflowId = null;
  try {
    const r = await fetch(\`/api/scenariofieldconfigs?_projectId=\${PROJECT_ID}&_objectType=task\`);
    existingTypes = await r.json();
    if (Array.isArray(existingTypes) && existingTypes.length > 0) {
      defaultTaskflowId = existingTypes[0].taskflowId;
    }
  } catch (e) {
    console.warn("Could not fetch existing types, will use no taskflowId:", e);
  }

  const existingNames = new Set(existingTypes.map((t) => t.name));
  const created = [];
  const skipped = [];
  const errors = [];

  for (const t of TYPES) {
    if (existingNames.has(t.name)) {
      skipped.push(t.name);
      continue;
    }
    try {
      const body = {
        _projectId: PROJECT_ID,
        name: t.name,
        icon: t.icon || "task",
        objectType: "task",
      };
      if (defaultTaskflowId) body.taskflowId = defaultTaskflowId;

      const res = await fetch("/api/scenariofieldconfigs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      created.push({ name: t.name, scenariofieldconfigId: data._id });
      await new Promise((r) => setTimeout(r, 200));
    } catch (e) {
      errors.push({ name: t.name, error: e.message });
    }
  }

  console.log("Setup complete:");
  console.log("  Created:", created);
  console.log("  Skipped (already exist):", skipped);
  console.log("  Errors:", errors);
  return { created, skipped, errors };
})();
`;

  return formatResponse({
    instructions:
      "Browser-executable script. Run on Teambition while logged in. Use with Playwright page.evaluate() or paste into F12 console.",
    project_id: projectId,
    types_to_create: types,
    js_payload: jsPayload,
    notes: [
      "Skips types that already exist in the project",
      "Reuses the default taskflowId from existing types",
      "Returns map of {name → scenariofieldconfigId} for created types",
      "Save the returned IDs to use as task_type_id in create_task",
    ],
  });
}

// ============================================================================
// Handlers - Task Lifecycle
// ============================================================================

async function handleArchiveTask(args: Record<string, unknown>) {
  const data = await apiCall("POST", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/archive`, {});
  return formatResponse(data);
}

async function handleDeleteTask(args: Record<string, unknown>) {
  const data = await apiCall("DELETE", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}`, undefined, {
    projectId: args.project_id as string,
  });
  return formatResponse(data);
}

// ============================================================================
// Handlers - Query Support
// ============================================================================

async function handleQueryTaskWorkflowStatuses(args: Record<string, unknown>) {
  const userId = args.user_id as string;
  const projectId = args.project_id as string;
  const query = args.query as string | undefined;

  // Use the dedicated search API: GET /v1.0/project/users/{userId}/projects/{projectId}/taskflowStatuses/search
  // Returns ALL statuses (not just used ones), with kind=start|end|unset to identify done states
  const params: Record<string, string> = { maxResults: "300" };
  if (query) params.query = query;

  const data = await apiCall(
    "GET",
    `/v1.0/project/users/${userId}/projects/${projectId}/taskflowStatuses/search`,
    undefined,
    params
  );

  const statuses = (data as { result?: Record<string, unknown>[] }).result || [];

  // Group by taskflowId (each task type has its own workflow)
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
          kind: s.kind, // "start" | "end" | "unset"
          pos: s.pos,
          is_start: s.kind === "start",
          is_end: s.kind === "end", // ← Use this to mark task as done
        })),
    })),
    usage: 'Use update_task_workflow_status with kind="end" status to mark task done. Each task type (scenariofieldconfigId) has its own taskflow.',
  });
}

async function handleQueryProjectStages(args: Record<string, unknown>) {
  const userId = args.user_id as string;
  const projectId = args.project_id as string;

  const data = await apiCall(
    "GET",
    `/v1.0/project/users/${userId}/projectIds/${projectId}/tasks`,
    undefined,
    { maxResults: "200" }
  );

  const tasks = (data as { result?: Record<string, unknown>[] }).result || [];

  // Aggregate by stageId
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

// ============================================================================
// Handlers - Excel Sync
// ============================================================================

async function handleParseExcel(args: Record<string, unknown>) {
  const filePath = args.file_path as string;
  const absPath = resolve(filePath);

  if (!existsSync(absPath)) {
    return errorResponse(`File not found: ${absPath}`);
  }

  const { execSync } = await import("child_process");

  const { tmpdir } = await import("os");
  const tmpScript = `${tmpdir()}/teambition_parse_${Date.now()}.py`;
  const { writeFileSync, unlinkSync } = await import("fs");

  const pythonSrc = `import openpyxl, json, sys
sys.stdout.reconfigure(encoding='utf-8')
wb = openpyxl.load_workbook(r"""${absPath}""", data_only=True)
ws = wb[wb.sheetnames[0]]
rows = [[str(c) if c is not None else "" for c in r] for r in ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True)]
# Skip header row
data_rows = rows[1:]
print(json.dumps(data_rows, ensure_ascii=False))`;

  writeFileSync(tmpScript, pythonSrc, "utf-8");

  try {
    let output: string;
    try {
      output = execSync(`python3 "${tmpScript}"`, {
        encoding: "utf-8",
        timeout: 15000,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
    } catch {
      output = execSync(`python "${tmpScript}"`, {
        encoding: "utf-8",
        timeout: 15000,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
    }
    const rows = JSON.parse(output);
    const tasks = parseExcelRows(rows);

    const typeCounts: Record<string, number> = {};
    const stageCounts: Record<number, number> = {};
    for (const t of tasks) {
      typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
      stageCounts[t.sn] = (stageCounts[t.sn] || 0) + 1;
    }

    return formatResponse({
      total_tasks: tasks.length,
      stage_count: Object.keys(stageCounts).length,
      type_summary: typeCounts,
      stage_summary: stageCounts,
      tasks: tasks.map((t) => ({
        sn: t.sn,
        type: t.type,
        content: t.content,
        priority: t.priority,
        note: t.note,
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(`Excel parsing failed: ${msg}. Make sure Python3 and openpyxl are installed (pip install openpyxl).`);
  } finally {
    try { unlinkSync(tmpScript); } catch {}
  }
}

async function handleGenerateSyncPayload(args: Record<string, unknown>) {
  const tasks: TaskItem[] = JSON.parse(args.tasks_json as string);
  const projectId = args.project_id as string;
  const tasklistId = args.tasklist_id as string;
  const stageMap: Record<string, string> = JSON.parse(args.stage_map_json as string);

  const jsPayload = `
// Copy-paste this into browser console (F12) while on Teambition project page
// Or use with Playwright page.evaluate()

(async () => {
  const STAGES = ${JSON.stringify(stageMap)};
  const PID = "${projectId}";
  const TID = "${tasklistId}";
  const TASKS = ${JSON.stringify(tasks)};

  let created = 0, errors = 0;
  for (const t of TASKS) {
    const stageId = STAGES[t.sn] || Object.values(STAGES)[0];
    try {
      await fetch("https://www.teambition.com/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: t.content,
          _projectId: PID,
          _tasklistId: TID,
          _stageId: stageId,
          priority: t.priority,
          note: t.note,
        }),
      });
      created++;
    } catch(e) { errors++; }
    if (created % 10 === 0) await new Promise(r => setTimeout(r, 300));
  }
  console.log(\`Created: \${created}, Errors: \${errors}\`);
  return { created, errors };
})();
`;

  return formatResponse({
    instructions: "This is a browser-executable script. Use it with Playwright page.evaluate() or paste into browser console while on the Teambition project page.",
    total_tasks: tasks.length,
    stage_count: Object.keys(stageMap).length,
    js_payload: jsPayload,
  });
}

async function handleQueryTaskStats(args: Record<string, unknown>) {
  const userId = args.user_id as string;
  const projectId = args.project_id as string;

  const data = await apiCall(
    "GET",
    `/v1.0/project/users/${userId}/projectIds/${projectId}/tasks`,
    undefined,
    { maxResults: "200" }
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

// ============================================================================
// Helpers
// ============================================================================

function formatResponse(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResponse(msg: string) {
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

// ============================================================================
// Handler Map
// ============================================================================

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  get_organization: handleGetOrganization,
  create_project: handleCreateProject,
  create_task: handleCreateTask,
  get_task: handleGetTask,
  query_tasks: handleQueryTasks,
  update_task_content: handleUpdateTaskContent,
  update_task_executor: handleUpdateTaskExecutor,
  update_task_due_date: handleUpdateTaskDueDate,
  update_task_start_date: handleUpdateTaskStartDate,
  update_task_priority: handleUpdateTaskPriority,
  update_task_note: handleUpdateTaskNote,
  update_task_workflow_status: handleUpdateTaskWorkflowStatus,
  update_task_custom_fields: handleUpdateTaskCustomFields,
  update_task_participants: handleUpdateTaskParticipants,
  update_task_batch: handleUpdateTaskBatch,
  generate_move_task_stage_payload: handleGenerateMoveTaskStagePayload,
  generate_change_task_type_payload: handleGenerateChangeTaskTypePayload,
  query_task_types: handleQueryTaskTypes,
  generate_query_task_types_payload: handleGenerateQueryTaskTypesPayload,
  generate_create_task_type_payload: handleGenerateCreateTaskTypePayload,
  generate_setup_standard_task_types_payload: handleGenerateSetupStandardTaskTypesPayload,
  archive_task: handleArchiveTask,
  delete_task: handleDeleteTask,
  query_task_workflow_statuses: handleQueryTaskWorkflowStatuses,
  query_project_stages: handleQueryProjectStages,
  parse_excel: handleParseExcel,
  generate_sync_payload: handleGenerateSyncPayload,
  query_task_stats: handleQueryTaskStats,
};

// ============================================================================
// Server
// ============================================================================

const server = new Server(
  { name: "teambition", version: "0.3.0" },
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
