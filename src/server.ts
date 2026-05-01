#!/usr/bin/env node
/**
 * DWS Teambition Plugin - MCP Stdio Server
 * 
 * Wraps DingTalk Teambition Project Management APIs as MCP tools.
 * Supports the full Excel→Teambition reproducible workflow:
 *   1. parse_excel    → classify tasks from Excel
 *   2. create_project → setup Teambition project
 *   3. sync_helper    → generate batch-create payload for browser API
 *   4. query_stats    → verify sync results
 * 
 * Auth: Uses DWS_CLIENT_ID / DWS_CLIENT_SECRET environment variables.
 * 
 * Note: Stage-aware task creation requires Teambition browser API
 * (used via Playwright in the workflow). DingTalk API does NOT support
 * stageId/tasklistId assignment.
 * 
 * DWS CLI converts camelCase flags to snake_case params.
 * All tool parameters use snake_case naming.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ---- Configuration ----

const DINGTALK_API = "https://api.dingtalk.com";
const CLIENT_ID = process.env.DWS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DWS_CLIENT_SECRET || "";

// ---- Token Cache ----

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
  const data = await res.json() as { accessToken: string; expireIn: number };
  cachedToken = {
    token: data.accessToken,
    expiresAt: Date.now() + data.expireIn * 1000,
  };
  return cachedToken.token;
}

async function apiCall(method: string, path: string, body?: unknown, params?: Record<string, string>): Promise<unknown> {
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

// ---- Excel Parsing Logic ----

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

// ---- Tool Definitions ----

const TOOLS = [
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
  {
    name: "create_task",
    description: "在指定项目中创建任务（注：DingTalk API 不支持 stageId 分配，任务将进入默认分组）",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        project_id: { type: "string", description: "项目 ID" },
        content: { type: "string", description: "任务标题" },
        executor_id: { type: "string", description: "执行者 userId（可选）" },
        priority: { type: "number", description: "优先级: -10=低, 0=普通, 1=紧急, 2=非常紧急（可选）" },
        due_date: { type: "string", description: "截止时间，ISO 8601 格式（可选）" },
        note: { type: "string", description: "任务备注（可选）" },
      },
      required: ["user_id", "project_id", "content"],
    },
  },
  {
    name: "query_tasks",
    description: "查询项目中的任务，支持 TQL 筛选",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "操作者的钉钉 userId" },
        project_id: { type: "string", description: "项目 ID" },
        query: { type: "string", description: "TQL 查询条件（可选）" },
        max_results: { type: "number", description: "每页最大数量，默认 50" },
      },
      required: ["user_id", "project_id"],
    },
  },
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
    description: "删除任务",
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
  {
    name: "parse_excel",
    description: "解析 Excel 研发流程文件，自动分类任务（milestone/risk/design/qaqc/legal/change/improve/requirement/task）。返回 JSON 格式的任务列表，可直接用于同步。",
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
    description: "根据 parse_excel 的输出，生成用于浏览器 API 批量创建的 JS payload 脚本。包含 stage_id_map 占位符，需用实际 stage ID 替换后执行。",
    inputSchema: {
      type: "object",
      properties: {
        tasks_json: { type: "string", description: "parse_excel 输出的 JSON 字符串" },
        project_id: { type: "string", description: "Teambition 项目 ID" },
        tasklist_id: { type: "string", description: "Teambition 默认分组的 tasklistId" },
        stage_map_json: { type: "string", description: "JSON mapping of stage numbers to stage IDs, e.g. {\"1\":\"xxx\",\"2\":\"yyy\"}" },
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

// ---- Handlers ----

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

async function handleCreateTask(args: Record<string, unknown>) {
  const body: Record<string, unknown> = { content: args.content, projectId: args.project_id };
  if (args.executor_id) body.executorId = args.executor_id;
  if (args.priority !== undefined) body.priority = args.priority;
  if (args.due_date) body.dueDate = args.due_date;
  if (args.note) body.note = args.note;
  const data = await apiCall("POST", `/v1.0/project/users/${args.user_id}/tasks`, body);
  return formatResponse(data);
}

async function handleQueryTasks(args: Record<string, unknown>) {
  const params: Record<string, string> = {};
  if (args.query) params.query = args.query as string;
  if (args.max_results) params.maxResults = String(args.max_results);
  else params.maxResults = "50";
  const data = await apiCall("GET",
    `/v1.0/project/users/${args.user_id}/projectIds/${args.project_id}/tasks`, undefined, params);
  return formatResponse(data);
}

async function handleArchiveTask(args: Record<string, unknown>) {
  const data = await apiCall("POST", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/archive`, {});
  return formatResponse(data);
}

async function handleDeleteTask(args: Record<string, unknown>) {
  const data = await apiCall("DELETE", `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}`, undefined,
    { projectId: args.project_id as string });
  return formatResponse(data);
}

async function handleParseExcel(args: Record<string, unknown>) {
  const filePath = args.file_path as string;
  const absPath = resolve(filePath);

  if (!existsSync(absPath)) {
    return errorResponse(`File not found: ${absPath}`);
  }

  const { execSync } = await import("child_process");

  // Write Python script to temp file (avoids command-line escaping issues)
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
    // Try python3 first, fall back to python
    let output: string;
    try {
      output = execSync(`python3 "${tmpScript}"`, { encoding: "utf-8", timeout: 15000, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    } catch {
      output = execSync(`python "${tmpScript}"`, { encoding: "utf-8", timeout: 15000, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    }
    const rows = JSON.parse(output);
    const tasks = parseExcelRows(rows);

    // Generate summary
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
      tasks: tasks.map(t => ({
        sn: t.sn, type: t.type, content: t.content,
        priority: t.priority, note: t.note,
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(`Excel parsing failed: ${msg}. Make sure Python3 and openpyxl are installed (pip install openpyxl).`);
  } finally {
    // Cleanup temp script
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

  // Query all tasks via DingTalk API (flat list)
  const data = await apiCall("GET",
    `/v1.0/project/users/${userId}/projectIds/${projectId}/tasks`, undefined,
    { maxResults: "200" });

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

// ---- Helpers ----

function formatResponse(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResponse(msg: string) {
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

// ---- Handler Map ----

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  get_organization: handleGetOrganization,
  create_project: handleCreateProject,
  create_task: handleCreateTask,
  query_tasks: handleQueryTasks,
  archive_task: handleArchiveTask,
  delete_task: handleDeleteTask,
  parse_excel: handleParseExcel,
  generate_sync_payload: handleGenerateSyncPayload,
  query_task_stats: handleQueryTaskStats,
};

// ---- Server ----

const server = new Server(
  { name: "teambition", version: "0.2.0" },
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
