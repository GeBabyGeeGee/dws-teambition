---
name: teambition
description: Manage Teambition projects/tasks via DingTalk OpenAPI. Supports reproducible Excel-to-Teambition sync workflow with auto task classification.
cli_version: ">=v1.0.18"
---

# Teambition (项目管理)

通过钉钉开放平台的 Teambition 项目管理 API，管理项目、任务。支持 Excel 研发流程文件自动导入。

## Prerequisites

1. Create internal app at [open-dev.dingtalk.com](https://open-dev.dingtalk.com)
2. Grant permissions: `qyapi_project`, `Project.Task.Write.All`, `Project.Task.Read.All`
3. Set env: `DWS_CLIENT_ID` / `DWS_CLIENT_SECRET`
4. `pip install openpyxl` (for Excel parsing)

## Commands

| Command | Description |
|---------|-------------|
| `get-organization` | Get Teambition organization ID |
| `create-project` | Create project |
| `create-task` | Create task (goes to default group) |
| `query-tasks` | Query tasks with TQL filter |
| `archive-task` | Archive task |
| `delete-task` | Delete task |
| `parse-excel` | Parse Excel R&D process file, auto-classify tasks |
| `generate-sync-payload` | Generate browser batch-create script |
| `query-task-stats` | Query task statistics by type/priority |

---

## Workflow: Excel to Teambition Sync (Reproducible)

### Overview

Input: Excel file (10 columns: SN/Stage/InputDept/InputReq/OutputDept/Owner/Reviewer/Deliverable/KeyNode/Notes)
Output: Teambition project with 16 stage groups and classified tasks

### Classification Rules

| Condition | Type | Priority |
|-----------|------|----------|
| Contains "风险"/"评估" | `[risk]` | 2 (Critical) |
| "√" + contains "评审"/"确认"/"签样"/"报告" | `[milestone]` | 2 |
| "√" other | `[milestone]` | 2 |
| Contains "合同"/"协议"/"专利" | `[legal]` | 0 (Normal) |
| Contains "ECR"/"变更" | `[change]` | 1 (Urgent) |
| Contains "设计"/"图"/"方案"/"效果图"/"原理图" | `[design]` | 0 |
| Contains "测试"/"检验"/"验证"/"认证" | `[qaqc]` | 1 |
| Contains "整改"/"改善" | `[improve]` | 0 |
| Contains "需求"/"要求"/"立项" | `[requirement]` | 0 |
| Other | `[task]` | -10 (Low) |

### Execution Steps

#### Step 1: Parse Excel

```
dws teambition parse-excel --file-path "/path/to/file.xlsx"
```

Returns: JSON with classified task list (92 tasks, 16 stages)

#### Step 2: Create Teambition Project

```
dws teambition create-project --user-id <userId> --name "Project Name"
```

Save the returned `projectId`, `rootCollectionId`, `defaultCollectionId`.

#### Step 3: Create Task Groups (Browser Required)

Why browser: DingTalk OpenAPI does NOT support task group/stage management.
Use Playwright to automate:

1. Login to `https://www.teambition.com/project/{projectId}`
2. Click "新建任务列表" button, create 16 groups
3. Call `GET /api/tasklists?_projectId={projectId}` to get stage IDs
4. Extract each stage's `_id`

16 stage names:
```
1.项目立项  2.外观设计  3.风险评估  4.设计验证标准
5.电子设计  6.结构设计  7.专利申请  8.功能手板评审
9.设计开模  10.TO-Tn验证  11.包装设计  12.试产
13.设计变更  14.品控管理  15.产品质检  16.持续改善
```

#### Step 4: Generate & Execute Batch Sync

```
dws teambition generate-sync-payload \
  --tasks-json '<step1-output>' \
  --project-id <projectId> \
  --tasklist-id <defaultGroupListId> \
  --stage-map-json '{"1":"stageId1","2":"stageId2",...}'
```

Inject generated JS into browser:

```
// Paste in F12 Console, or use Playwright page.evaluate()
```

#### Step 5: Verify

```
dws teambition query-task-stats --user-id <id> --project-id <projectId>
```

---

## Playwright Automation Reference

When using as AI Agent with Playwright MCP:

```
// 1. Navigate
page.goto('https://www.teambition.com/project/{pid}')

// 2. Create task groups
for each name in [...16 names...]:
  click button("新建任务列表")
  fill input[placeholder="列表名称"] with name
  press Enter
  press Escape

// 3. Get stage IDs
page.evaluate(async () => {
  const r = await fetch('/api/tasklists?_projectId={pid}')
  const data = await r.json()
  return Object.fromEntries(
    data[0].hasStages
      .filter(s => /^\d+\./.test(s.name))
      .map(s => [s.name.match(/^(\d+)/)[1], s._id])
  )
})

// 4. Batch create tasks
page.evaluate(async (tasks, stages, pid, tid) => {
  for (const t of tasks) {
    await fetch('/api/tasks', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        content:t.content, _projectId:pid, _tasklistId:tid,
        _stageId:stages[t.sn], priority:t.priority, note:t.note
      })
    })
  }
}, TASKS, stages, PID, TID)
```

## Task Priority Reference

| Value | Meaning |
|-------|---------|
| `2` | Critical (milestones, risks) |
| `1` | Urgent (ECO, QA/QC) |
| `0` | Normal (design, legal, requirements) |
| `-10` | Low (general tasks) |
