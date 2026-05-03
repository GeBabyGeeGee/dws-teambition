#!/usr/bin/env bun
/**
 * @deprecated Since v0.4.0 - Use the plugin's browser API instead:
 *   dws teambition parse-excel → dws teambition generate_sync_payload
 *   Or use: generate_create_tasklist_payload + generate_rename_stage_payload
 *
 * Standalone script kept for reference. Requires DWS_CLIENT_ID/SECRET env vars.
 * Shared logic (classify, PREFIX, PRIORITY) now lives in src/lib/excel.ts.
 */
import * as fs from "fs";
import * as path from "path";

const DINGTALK_API = "https://api.dingtalk.com";
const CLIENT_ID = process.env.DWS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DWS_CLIENT_SECRET || "";
const USER_ID = process.env.DWS_USER_ID || "";

if (!CLIENT_ID || !CLIENT_SECRET || !USER_ID) {
  console.error("Missing env");
  process.exit(1);
}

// Organization members
const MEMBER_A = "376752496721035452"; // owner - 产品/管理类
const MEMBER_B = "47074447690143"; // member - 技术/执行类

let cachedToken: any = null;
async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const res = await fetch(`${DINGTALK_API}/v1.0/oauth2/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey: CLIENT_ID, appSecret: CLIENT_SECRET }),
  });
  const data: any = await res.json();
  cachedToken = { token: data.accessToken, expiresAt: Date.now() + data.expireIn * 1000 };
  return cachedToken.token;
}

async function api(method: string, urlPath: string, body?: any, params?: Record<string, string>) {
  const token = await getToken();
  let url = `${DINGTALK_API}${urlPath}`;
  if (params) url += `?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    method,
    headers: { "x-acs-dingtalk-access-token": token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${method} ${urlPath} (${res.status}): ${text}`);
  return text ? JSON.parse(text) : {};
}

// ---- Classification (mirrors server.ts) ----
function classify(deliverable: string, isKey: boolean): string {
  if (deliverable.includes("风险") || deliverable.includes("评估")) return "risk";
  if (deliverable.includes("合同") || deliverable.includes("协议") || deliverable.includes("专利")) return "legal";
  if (deliverable.includes("变更") || deliverable.includes("ECR")) return "change";
  if (isKey && (deliverable.includes("评审") || deliverable.includes("确认") || deliverable.includes("签样") || deliverable.includes("报告"))) return "milestone";
  if (isKey) return "milestone";
  if (deliverable.includes("设计") || deliverable.includes("图") || deliverable.includes("方案") || deliverable.includes("效果图") || deliverable.includes("原理图")) return "design";
  if (deliverable.includes("测试") || deliverable.includes("检验") || deliverable.includes("验证") || deliverable.includes("认证")) return "qaqc";
  if (deliverable.includes("整改") || deliverable.includes("改善")) return "improve";
  if (deliverable.includes("需求") || deliverable.includes("要求") || deliverable.includes("立项")) return "requirement";
  return "task";
}

const PREFIX = {
  milestone: "[milestone] ", risk: "[risk] ", design: "[design] ", qaqc: "[qaqc] ",
  requirement: "[requirement] ", legal: "[legal] ", change: "[change] ", improve: "[improve] ", task: "[task] ",
};
const PRIORITY: Record<string, number> = {
  milestone: 2, risk: 2, change: 1, qaqc: 1, design: 0, requirement: 0, legal: 0, improve: 0, task: -10,
};

// ---- Assign executor based on owner field ----
function assignUser(owner: string): string {
  const aKeywords = ["产品经理", "产品助理", "产品中心", "项目经理", "业务"];
  const bKeywords = ["工程师", "品质", "生产", "采购", "ID设计", "包装", "方案公司", "外观设计"];
  
  for (const kw of bKeywords) {
    if (owner.includes(kw)) return MEMBER_B;
  }
  for (const kw of aKeywords) {
    if (owner.includes(kw)) return MEMBER_A;
  }
  return MEMBER_A; // default
}

// ---- Parse Excel ----
import { execSync } from "child_process";

const EXCEL_PATH = "C:\\Workspace\\dws-teambition\\研发流程及过程文件清单A-1.xlsx";
const tmpScript = `${require("os").tmpdir()}/tb_parse_${Date.now()}.py`;
const pythonSrc = `import openpyxl, json, sys
sys.stdout.reconfigure(encoding='utf-8')
wb = openpyxl.load_workbook(r"""${EXCEL_PATH}""", data_only=True)
ws = wb[wb.sheetnames[0]]
rows = [[str(c) if c is not None else "" for c in r] for r in ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True)]
data_rows = rows[1:]
print(json.dumps(data_rows, ensure_ascii=False))`;

fs.writeFileSync(tmpScript, pythonSrc, "utf-8");
let rows: string[][];
try {
  let output: string;
  try {
    output = execSync(`python3 "${tmpScript}"`, { encoding: "utf-8", timeout: 15000 });
  } catch {
    output = execSync(`python "${tmpScript}"`, { encoding: "utf-8", timeout: 15000 });
  }
  rows = JSON.parse(output);
} finally {
  try { fs.unlinkSync(tmpScript); } catch {}
}

// Build task list
interface ParsedTask {
  stageNum: number;
  stageName: string;
  content: string;
  type: string;
  priority: number;
  note: string;
  executorId: string;
  isKey: boolean;
}

const tasks: ParsedTask[] = [];
let currentStageNum = 0;
let currentStageName = "";

for (const row of rows) {
  const [num, stage, inDept, inReq, outDept, owner, reviewer, deliverable, keyNode, notes] = row;

  // Stage header row
  if (num && /^\d+$/.test(num)) {
    currentStageNum = parseInt(num);
    currentStageName = stage;
    // Create stage milestone header task
    tasks.push({
      stageNum: currentStageNum,
      stageName: currentStageName,
      content: `[milestone] ${currentStageNum}.${currentStageName}`,
      type: "milestone",
      priority: 2,
      note: `Stage ${currentStageNum}: ${currentStageName}`,
      executorId: MEMBER_A,
      isKey: true,
    });
  }

  // Deliverable row
  if (deliverable && deliverable.trim()) {
    const isKey = keyNode === "√";
    const type = classify(deliverable, isKey);

    const noteParts: string[] = [];
    if (inDept) noteParts.push(`Input Dept: ${inDept}`);
    if (inReq) noteParts.push(`Input: ${inReq}`);
    if (outDept) noteParts.push(`Output Dept: ${outDept}`);
    if (owner) noteParts.push(`Owner: ${owner}`);
    if (reviewer) noteParts.push(`Reviewer: ${reviewer}`);
    if (isKey) noteParts.push("⚠ KEY MILESTONE");
    if (notes) noteParts.push(`Note: ${notes}`);

    tasks.push({
      stageNum: currentStageNum,
      stageName: currentStageName,
      content: PREFIX[type] + deliverable,
      type,
      priority: PRIORITY[type],
      note: noteParts.join("\n"),
      executorId: assignUser(owner),
      isKey,
    });
  }
}

console.log(`\n📋 Classified ${tasks.length} tasks (${tasks.filter(t => t.isKey).length} KEY milestones)`);

// Type summary
const typeCounts: Record<string, number> = {};
for (const t of tasks) typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
console.log("Types:", JSON.stringify(typeCounts));
console.log("Member A:", tasks.filter(t => t.executorId === MEMBER_A).length, "tasks");
console.log("Member B:", tasks.filter(t => t.executorId === MEMBER_B).length, "tasks");

// ========================
// Execute
// ========================

const TS = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const PROJECT_NAME = `[R&D] 研发流程-${TS}`;

console.log(`\n${'='.repeat(60)}`);
console.log(`🚀 Starting batch task creation`);
console.log(`   Project: ${PROJECT_NAME}`);
console.log(`   Tasks: ${tasks.length}`);
console.log(`${'='.repeat(60)}\n`);

// Step 1: Create project
const project = await api("POST", `/v1.0/project/users/${USER_ID}/projects`, { name: PROJECT_NAME });
const pid = project.result?.projectId || project.result?.id;
console.log(`✅ Project created: ${pid}`);
console.log(`   URL: https://www.teambition.com/project/${pid}\n`);

// Step 2: Create tasks in batches to avoid rate limits
const BATCH_SIZE = 10;
let created = 0;
let failed = 0;
const results: { taskId: string; content: string; type: string; executor: string }[] = [];

for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
  const batch = tasks.slice(i, i + BATCH_SIZE);
  const promises = batch.map(async (t, idx) => {
    try {
      const res = await api("POST", `/v1.0/project/users/${USER_ID}/tasks`, {
        content: t.content,
        projectId: pid,
        priority: t.priority,
        note: t.note || undefined,
        executorId: t.executorId,
      });
      const tid = res.result?.taskId || res.result?.id;
      return { ok: true, taskId: tid, content: t.content, type: t.type, executor: t.executorId };
    } catch (e: any) {
      return { ok: false, error: e.message, content: t.content };
    }
  });
  
  const batchResults = await Promise.all(promises);
  for (const r of batchResults) {
    if (r.ok) {
      created++;
      results.push(r as any);
    } else {
      failed++;
      console.error(`  ❌ FAILED: ${r.content} - ${r.error}`);
    }
  }
  
  // Delay between batches
  if (i + BATCH_SIZE < tasks.length) {
    await new Promise(r => setTimeout(r, 500));
  }
  
  const pct = Math.round((i + batch.length) / tasks.length * 100);
  process.stdout.write(`\r   Progress: ${created}/${tasks.length} (${pct}%)  [${'#'.repeat(pct/4)}${'-'.repeat(25-pct/4)}]`);
}

console.log(`\n\n${'='.repeat(60)}`);
console.log(`📊 Results:`);
console.log(`   ✅ Created: ${created}`);
console.log(`   ❌ Failed: ${failed}`);
console.log(`   📍 Project: https://www.teambition.com/project/${pid}`);
console.log(`${'='.repeat(60)}\n`);

// Type breakdown
const createdTypes: Record<string, number> = {};
for (const r of results) createdTypes[r.type] = (createdTypes[r.type] || 0) + 1;
console.log("Type breakdown:", JSON.stringify(createdTypes));
const memberACount = results.filter(r => r.executor === MEMBER_A).length;
const memberBCount = results.filter(r => r.executor === MEMBER_B).length;
console.log(`Member A (${MEMBER_A}): ${memberACount} tasks`);
console.log(`Member B (${MEMBER_B}): ${memberBCount} tasks`);

// Save state
fs.writeFileSync(".rd-batch-state.json", JSON.stringify({ projectId: pid, projectName: PROJECT_NAME, results }, null, 2));
console.log("\n💾 State saved to .rd-batch-state.json");
