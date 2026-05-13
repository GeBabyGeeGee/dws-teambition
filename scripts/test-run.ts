#!/usr/bin/env bun
/**
 * Test runner for dws-teambition plugin
 * Exercises the same API logic used in src/server.ts against a real DingTalk org.
 *
 * Required env: DWS_CLIENT_ID, DWS_CLIENT_SECRET, DWS_USER_ID
 *
 * Usage:
 *   bun scripts/test-run.ts <step>
 *
 * Steps:
 *   1  - Get organization
 *   2  - Create test project
 *   3  - Create tasks (different categories)
 *   4  - Query tasks
 *   5  - Update task (multiple fields)
 *   6  - Query workflow statuses + mark done
 *   7  - Query task types
 *   all - Run 1-7 sequentially with state persistence
 */

const DINGTALK_API = "https://api.dingtalk.com";
const CLIENT_ID = process.env.DWS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DWS_CLIENT_SECRET || "";
const USER_ID = process.env.DWS_USER_ID || "";

if (!CLIENT_ID || !CLIENT_SECRET || !USER_ID) {
  console.error("Missing env: DWS_CLIENT_ID / DWS_CLIENT_SECRET / DWS_USER_ID");
  process.exit(1);
}

const STATE_FILE = ".test-state.json";
let state: Record<string, any> = {};
try {
  const fs = await import("fs");
  if (fs.existsSync(STATE_FILE)) {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  }
} catch {}

function saveState() {
  const fs = require("fs");
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let cachedToken: { token: string; expiresAt: number } | null = null;
async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const res = await fetch(`${DINGTALK_API}/v1.0/oauth2/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey: CLIENT_ID, appSecret: CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error(`Token failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { accessToken: string; expireIn: number };
  cachedToken = { token: data.accessToken, expiresAt: Date.now() + data.expireIn * 1000 };
  return cachedToken.token;
}

async function api(method: string, path: string, body?: any, params?: Record<string, string>) {
  const token = await getAccessToken();
  let url = `${DINGTALK_API}${path}`;
  if (params) url += `?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    method,
    headers: { "x-acs-dingtalk-access-token": token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : {};
}

const COLOR = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m", yellow: "\x1b[33m" };
function ok(msg: string) { console.log(`${COLOR.green}✓${COLOR.reset} ${msg}`); }
function info(msg: string) { console.log(`${COLOR.cyan}ℹ${COLOR.reset} ${msg}`); }
function warn(msg: string) { console.log(`${COLOR.yellow}⚠${COLOR.reset} ${msg}`); }
function fail(msg: string) { console.log(`${COLOR.red}✗${COLOR.reset} ${msg}`); }
function pretty(obj: any) { console.log(JSON.stringify(obj, null, 2)); }

// ---- Steps ----

async function step1_getOrg() {
  info("Step 1: get_organization");
  const data = await api("GET", "/v1.0/project/teambition/organizations", undefined, { optUserId: USER_ID });
  state.organizationId = data.result?.tbOrganizationId;
  saveState();
  ok(`Organization ID: ${state.organizationId}`);
}

async function step2_createProject() {
  info("Step 2: create_project");
  const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const name = `[DWS-TEST] ${ts}`;
  const data = await api("POST", `/v1.0/project/users/${USER_ID}/projects`, { name });
  state.projectId = data.result?.id || data.result?.projectId;
  state.projectName = name;
  saveState();
  ok(`Created project "${name}"`);
  info(`  projectId: ${state.projectId}`);
  info(`  URL: https://www.teambition.com/project/${state.projectId}`);
}

async function step3_createTasks() {
  info("Step 3: create_task (multiple)");
  if (!state.projectId) throw new Error("No projectId — run step 2 first");

  const tasksToCreate = [
    { content: "[milestone] 项目立项评审", priority: 2, note: "KEY MILESTONE: Cannot proceed without passing" },
    { content: "[risk] 供应链风险评估", priority: 2, note: "评估关键供应商交期与质量风险" },
    { content: "[design] 外观效果图设计", priority: 0, note: "Owner: 设计部" },
    { content: "[qaqc] 功能样品测试验证", priority: 1, note: "Owner: 品质部, Reviewer: 工程部" },
    { content: "[task] 整理项目周报", priority: -10, note: "每周五下午整理" },
  ];

  state.taskIds = [];
  for (const t of tasksToCreate) {
    const data = await api("POST", `/v1.0/project/users/${USER_ID}/tasks`, {
      content: t.content,
      projectId: state.projectId,
      priority: t.priority,
      note: t.note,
    });
    const tid = data.result?.taskId || data.result?.id;
    state.taskIds.push({ id: tid, content: t.content });
    ok(`Created: ${t.content}  (taskId: ${tid})`);
  }
  saveState();
}

async function step4_queryTasks() {
  info("Step 4: query_tasks");
  if (!state.projectId) throw new Error("No projectId");
  const data = await api(
    "GET",
    `/v1.0/project/users/${USER_ID}/projectIds/${state.projectId}/tasks`,
    undefined,
    { maxResults: "20" }
  );
  ok(`Total tasks: ${data.totalCount}`);
  for (const t of data.result || []) {
    console.log(`  • [pri=${t.priority}] ${t.content}  isDone=${t.isDone}`);
  }
}

async function step5_updateTask() {
  info("Step 5: granular task updates (test new v0.3.0 features)");
  if (!state.taskIds?.length) throw new Error("No tasks — run step 3 first");

  const target = state.taskIds[2]; // The [design] task
  info(`Target task: "${target.content}"  (${target.id})`);

  // 5a. update_task_content
  await api("PUT", `/v1.0/project/users/${USER_ID}/tasks/${target.id}/contents`, { content: "[design] 外观效果图设计 - V2 修订" });
  ok("✓ update_task_content");

  // 5b. update_task_priority
  await api("PUT", `/v1.0/project/users/${USER_ID}/tasks/${target.id}/priorities`, { priority: 1 });
  ok("✓ update_task_priority (0 → 1 紧急)");

  // 5c. update_task_due_date
  const due = new Date(Date.now() + 7 * 86400000).toISOString();
  await api("PUT", `/v1.0/project/users/${USER_ID}/tasks/${target.id}/dueDates`, { dueDate: due });
  ok(`✓ update_task_due_date (${due})`);

  // 5d. update_task_note
  await api("PUT", `/v1.0/project/users/${USER_ID}/tasks/${target.id}/notes`, { note: "[v2] 增加色彩方案对比 + 用户反馈" });
  ok("✓ update_task_note");

  // 5e. update_task_executor (assign to self)
  await api("PUT", `/v1.0/project/users/${USER_ID}/tasks/${target.id}/executors`, { executorId: USER_ID });
  ok(`✓ update_task_executor (assigned to ${USER_ID})`);

  // Verify by re-querying
  const verify = await api(
    "GET",
    `/v1.0/project/users/${USER_ID}/projectIds/${state.projectId}/tasks`,
    undefined,
    { maxResults: "5", query: `taskId = "${target.id}"` }
  );
  const t = verify.result?.[0];
  if (t) {
    console.log("\nVerification (after updates):");
    pretty({ content: t.content, priority: t.priority, dueDate: t.dueDate, note: t.note, executorId: t.executorId });
  }
}

async function step6_workflowStatus() {
  info("Step 6: query workflow statuses (proper API) + mark done");
  if (!state.projectId) throw new Error("No projectId");

  // Use the dedicated search API
  const data = await api(
    "GET",
    `/v1.0/project/users/${USER_ID}/projects/${state.projectId}/taskflowStatuses/search`,
    undefined,
    { maxResults: "300" }
  );

  const statuses = data.result || [];
  ok(`Found ${statuses.length} workflow statuses`);
  for (const s of statuses) {
    console.log(`  • [${s.kind}] ${s.name}  (${s.taskflowStatusId})  pos=${s.pos}  taskflowId=${s.taskflowId}`);
  }

  // Find an "end" status (= done)
  const doneStatus = statuses.find((s: any) => s.kind === "end");
  if (doneStatus && state.taskIds?.length) {
    const target = state.taskIds[state.taskIds.length - 1]; // The [task] one
    info(`\nMarking "${target.content}" as done (status=${doneStatus.name} / ${doneStatus.taskflowStatusId})`);
    await api("PUT", `/v1.0/project/users/${USER_ID}/tasks/${target.id}/taskflowStatuses`, {
      taskflowStatusId: doneStatus.taskflowStatusId,
      tfsUpdateNote: "DWS plugin test - auto-completion",
    });
    ok("update_task_workflow_status — task marked done");

    // Verify
    const verify = await api(
      "GET",
      `/v1.0/project/users/${USER_ID}/tasks`,
      undefined,
      { taskId: target.id }
    );
    const t = verify.result?.[0];
    if (t) {
      console.log(`\nVerification: isDone=${t.isDone}, taskflowStatusId=${t.taskflowStatusId}`);
    }
  } else {
    warn(`No 'end' status found (or no tasks). doneStatus=${!!doneStatus}, tasks=${state.taskIds?.length}`);
  }
}

async function step7_queryTaskTypes() {
  info("Step 7: query_task_types (the feature we just added)");
  if (!state.projectId) throw new Error("No projectId");

  const data = await api(
    "GET",
    `/v1.0/project/users/${USER_ID}/projectIds/${state.projectId}/tasks`,
    undefined,
    { maxResults: "500" }
  );

  const typeMap = new Map<string, { count: number; samples: string[] }>();
  for (const t of data.result || []) {
    const sfcId = t.scenariofieldconfigId || "__default__";
    if (!typeMap.has(sfcId)) typeMap.set(sfcId, { count: 0, samples: [] });
    const e = typeMap.get(sfcId)!;
    e.count++;
    if (e.samples.length < 2) e.samples.push(t.content);
  }

  ok(`Found ${typeMap.size} distinct task types`);
  for (const [sfcId, v] of typeMap) {
    console.log(`  • scenariofieldconfigId: ${sfcId}`);
    console.log(`    count=${v.count}, samples=${JSON.stringify(v.samples)}`);
  }

  info("\nFor full task type details (name, icon, fields), run generate_query_task_types_payload");
  info("and execute the JS in browser at https://www.teambition.com/project/" + state.projectId);
}

async function step8_projectManagement() {
  info("Step 8: project management (list, join, members, status)");
  if (!state.projectId) warn("No projectId in state — using query only");

  // 8a. query_projects (search by name)
  info("8a: query_projects");
  const projects = await api(
    "POST",
    `/v1.0/project/users/${USER_ID}/projects/query`,
    undefined,
    { name: "[DWS-TEST]", maxResults: "10" }
  );
  const found = (projects.result || []).map((p: any) => `  ${p.projectId}: ${p.name}  (archived=${p.isArchived})`).join("\n");
  ok(`query_projects: ${(projects.result || []).length} projects found\n${found || "  (none)"}`);

  // 8b. get_user_join_projects
  info("8b: get_user_join_projects");
  const joined = await api("GET", `/v1.0/project/users/${USER_ID}/joinProjects`);
  ok(`get_user_join_projects: ${(joined.result || []).length} joined projects`);

  // 8c. get_project_members
  if (state.projectId) {
    info("8c: get_project_members");
    const members = await api(
      "GET",
      `/v1.0/project/users/${USER_ID}/projects/${state.projectId}/members`,
      undefined,
      { maxResults: "50" }
    );
    const mlist = (members.result || []).map((m: any) => `  userId=${m.userId} role=${m.role} (0=member,1=admin,2=owner)`).join("\n");
    ok(`get_project_members: ${(members.result || []).length} members\n${mlist || "  (none)"}`);
  }

  // 8d. query_project_status
  if (state.projectId) {
    info("8d: query_project_status");
    const statuses = await api(
      "GET",
      `/v1.0/project/users/${USER_ID}/projects/${state.projectId}/statuses`
    );
    const slist = (statuses.result || []).map((s: any) => `  ${s.name}: degree=${s.degree} (normal/risky/urgent)`).join("\n");
    ok(`query_project_status: ${(statuses.result || []).length} status entry/entries\n${slist || "  (none — publish project overview first)"}`);
  }
}

// ---- Dispatcher ----

const step = process.argv[2] || "all";
try {
  if (step === "1" || step === "all") await step1_getOrg();
  if (step === "2" || step === "all") await step2_createProject();
  if (step === "3" || step === "all") await step3_createTasks();
  if (step === "4" || step === "all") await step4_queryTasks();
  if (step === "5" || step === "all") await step5_updateTask();
  if (step === "6" || step === "all") await step6_workflowStatus();
  if (step === "7" || step === "all") await step7_queryTaskTypes();
  if (step === "8" || step === "all") await step8_projectManagement();
  console.log(`\n${COLOR.green}DONE${COLOR.reset}`);
} catch (e) {
  fail(`${e}`);
  process.exit(1);
}
