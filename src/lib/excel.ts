import { readFileSync, existsSync } from "fs";
import * as XLSX from "xlsx";
import { resolve } from "path";
import { TaskItem } from "../types.js";
import { formatResponse, errorResponse } from "./utils.js";

// ---- Classification Logic ----

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

export function parseExcelRows(rows: string[][]): TaskItem[] {
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

// ---- Excel File Handler (parse-excel command) ----

export async function handleParseExcel(args: Record<string, unknown>) {
  const filePath = args.file_path as string;
  const absPath = resolve(filePath);

  if (!existsSync(absPath)) {
    return errorResponse(`File not found: ${absPath}`);
  }

  try {
    const buf = readFileSync(absPath);
    const workbook = XLSX.read(buf, { type: "buffer", cellFormula: false, cellHTML: false });
    const sheetName = (args.sheet_name as string) || workbook.SheetNames[0];
    if (!workbook.SheetNames.includes(sheetName)) {
      return errorResponse(`Sheet "${sheetName}" not found. Available: ${workbook.SheetNames.join(", ")}`);
    }

    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", blankrows: false });
    if (rawRows.length <= 1) {
      return errorResponse("Excel file is empty or contains only a header row");
    }

    const dataRows = rawRows.slice(1).map((row) => row.map((c) => String(c ?? "")));
    const tasks = parseExcelRows(dataRows);

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
    return errorResponse(`Excel parsing failed: ${msg}`);
  }
}
