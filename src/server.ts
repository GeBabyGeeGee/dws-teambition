#!/usr/bin/env node
/**
 * DWS Teambition Plugin - MCP Stdio Server
 * 
 * Wraps DingTalk Teambition Project Management APIs as MCP tools.
 * Auth: Uses DWS_CLIENT_ID / DWS_CLIENT_SECRET environment variables.
 * 
 * Note: DWS CLI converts camelCase flags to snake_case params.
 * All tool parameters use snake_case naming.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

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

// ---- Tool Definitions (snake_case for DWS CLI compatibility) ----

const TOOLS = [
  {
    name: "get_organization",
    description: "获取当前用户的 Teambition 企业 (Organization) ID",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "钉钉用户 userId" },
      },
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
    description: "在指定项目中创建任务",
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
        max_results: { type: "number", description: "每页最大数量，默认 20" },
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
];

// ---- Tool Handlers ----

async function handleGetOrganization(args: Record<string, unknown>) {
  const data = await apiCall("GET", "/v1.0/project/teambition/organizations", undefined, {
    optUserId: args.user_id as string,
  });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function handleCreateProject(args: Record<string, unknown>) {
  const data = await apiCall(
    "POST",
    `/v1.0/project/users/${args.user_id}/projects`,
    { name: args.name }
  );
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function handleCreateTask(args: Record<string, unknown>) {
  const body: Record<string, unknown> = {
    content: args.content,
    projectId: args.project_id,
  };
  if (args.executor_id) body.executorId = args.executor_id;
  if (args.priority !== undefined) body.priority = args.priority;
  if (args.due_date) body.dueDate = args.due_date;
  if (args.note) body.note = args.note;

  const data = await apiCall(
    "POST",
    `/v1.0/project/users/${args.user_id}/tasks`,
    body
  );
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function handleQueryTasks(args: Record<string, unknown>) {
  const params: Record<string, string> = {};
  if (args.query) params.query = args.query as string;
  if (args.max_results) params.maxResults = String(args.max_results);

  const data = await apiCall(
    "GET",
    `/v1.0/project/users/${args.user_id}/projectIds/${args.project_id}/tasks`,
    undefined,
    params
  );
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function handleArchiveTask(args: Record<string, unknown>) {
  const data = await apiCall(
    "POST",
    `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}/archive`,
    {}
  );
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function handleDeleteTask(args: Record<string, unknown>) {
  const data = await apiCall(
    "DELETE",
    `/v1.0/project/users/${args.user_id}/tasks/${args.task_id}`,
    undefined,
    { projectId: args.project_id as string }
  );
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  get_organization: handleGetOrganization,
  create_project: handleCreateProject,
  create_task: handleCreateTask,
  query_tasks: handleQueryTasks,
  archive_task: handleArchiveTask,
  delete_task: handleDeleteTask,
};

// ---- Server Setup ----

const server = new Server(
  { name: "teambition", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = HANDLERS[name];
  if (!handler) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  try {
    return await handler((args || {}) as Record<string, unknown>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// ---- Start ----

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
