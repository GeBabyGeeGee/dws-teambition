---
name: teambition
description: Manage Teambition projects/tasks via DingTalk OpenAPI. Supports full task lifecycle, Excel-to-Teambition sync, and browser API for stage/type changes.
cli_version: ">=v1.0.18"
---

# Teambition (项目管理)

通过钉钉开放平台的 Teambition 项目管理 API，管理项目、任务。支持 Excel 研发流程文件自动导入。

## Prerequisites

1. Create internal app at [open-dev.dingtalk.com](https://open-dev.dingtalk.com)
2. Grant permissions: `qyapi_project`, `Project.Task.Write.All`, `Project.Task.Read.All`
3. Set env: `DWS_CLIENT_ID` / `DWS_CLIENT_SECRET`
4. `pip install openpyxl` (for Excel parsing)
5. `npm install -g @jackwener/opencli` (optional, for browser automation)

## Commands

### Project & Org (8)
| Command | Description |
|---------|-------------|
| `get-organization` | Get Teambition organization ID |
| `create-project` | Create project |
| `query-projects` | Query all projects with fuzzy search |
| `get-user-join-projects` | Get joined project IDs |
| `get-project-members` | List project members and roles |
| `add-project-members` | Batch add members |
| `remove-project-members` | Batch remove members |
| `query-project-status` | Query project overview status |

### Task CRUD
| Command | Description |
|---------|-------------|
| `create-task` | Create task (supports stageId, taskTypeId, customFields, startDate, participants, parentTask) |
| `get-task` | Get single task details |
| `query-tasks` | Query tasks with TQL filter, pagination |
| `archive-task` | Archive task |
| `delete-task` | Delete task |

### Task Update (Granular APIs)
| Command | Description | API Endpoint |
|---------|-------------|-------------|
| `update-task-content` | Update task title | `PUT .../tasks/{tid}/contents` |
| `update-task-executor` | Update task executor | `PUT .../tasks/{tid}/executors` |
| `update-task-due-date` | Update due date | `PUT .../tasks/{tid}/dueDates` |
| `update-task-start-date` | Update start date | `PUT .../tasks/{tid}/startDates` |
| `update-task-priority` | Update priority | `PUT .../tasks/{tid}/priorities` |
| `update-task-note` | Update note | `PUT .../tasks/{tid}/notes` |
| `update-task-workflow-status` | Update workflow status (mark as done) | `PUT .../tasks/{tid}/taskflowStatuses` |
| `update-task-custom-fields` | Update custom field values | `PUT .../tasks/{tid}/customFields` |
| `update-task-participants` | Add/remove participants | `PUT .../tasks/{tid}/involveMembers` |

### Task Update (Batch)
| Command | Description |
|---------|-------------|
| `update-task-batch` | Batch update multiple fields in one call |

### Task Stage & Type (Browser API)
| Command | Description |
|---------|-------------|
| `generate-move-task-stage-payload` | Generate JS to move task to different stage |
| `generate-change-task-type-payload` | Generate JS to change task type/template |

### Task Type Definition (定义任务类型)
| Command | Description |
|---------|-------------|
| `query-task-types` | List existing task types via DingTalk aggregation |
| `generate-query-task-types-payload` | Browser JS — fetch full type info (name/icon/fields) |
| `generate-create-task-type-payload` | Browser JS — create new task type |
| `generate-setup-standard-task-types-payload` | Browser JS — batch-create 9 R&D types |

### Query & Stats
| Command | Description |
|---------|-------------|
| `query-task-workflow-statuses` | List available workflow statuses |
| `query-project-stages` | List project stages with task counts |
| `query-task-stats` | Task statistics by type/priority |

### Excel Sync
| Command | Description |
|---------|-------------|
| `parse-excel` | Parse Excel R&D process file, auto-classify tasks |
| `generate-sync-payload` | Generate browser batch-create script |
| `query-task-stats` | Verify sync results |

---

## Quick Example: Modify a Task

```bash
# Update task title
dws teambition update-task-content --user-id <id> --task-id <tid> --content "New Title"

# Reassign task
dws teambition update-task-executor --user-id <id> --task-id <tid> --executor-id <uid>

# Change priority
dws teambition update-task-priority --user-id <id> --task-id <tid> --priority 2

# Batch update multiple fields at once
dws teambition update-task-batch \
  --user-id <id> \
  --task-id <tid> \
  --content "Updated Title" \
  --priority 1 \
  --executor-id <uid> \
  --due-date "2026-12-31T18:00:00Z"

# Mark task as done (get status ID first)
dws teambition query-task-workflow-statuses --user-id <id> --project-id <pid>
dws teambition update-task-workflow-status --user-id <id> --task-id <tid> --taskflow-status-id <sid>
```

---

## Workflow: Excel to Teambition Sync (Reproducible)

### Overview

Input: Excel file (10 columns: SN/Stage/InputDept/InputReq/OutputDept/Owner/Reviewer/Deliverable/KeyNode/Notes)
Output: Teambition project with 16 stage groups and classified tasks

### Classification Rules

| Condition | Type | Priority |
|-----------|------|----------|
| Contains "风险"/"评估" | `[risk]` | 2 (Critical) |
| KeyNode + "评审"/"确认"/"签样"/"报告" | `[milestone]` | 2 |
| KeyNode other | `[milestone]` | 2 |
| Contains "合同"/"协议"/"专利" | `[legal]` | 0 |
| Contains "ECR"/"变更" | `[change]` | 1 |
| Design keywords | `[design]` | 0 |
| QA/QC keywords | `[qaqc]` | 1 |
| Contains "整改"/"改善" | `[improve]` | 0 |
| Requirements keywords | `[requirement]` | 0 |
| Other | `[task]` | -10 |

### Steps

```bash
# Step 1: Parse & Classify
dws teambition parse-excel --file-path "研发流程清单.xlsx"

# Step 2: Create Project
dws teambition create-project --user-id <id> --name "项目名称"

# Step 3: Setup Task Groups (use opencli browser or F12 console)
# Use opencli browser eval or dws teambition generate-opencli-setup-payload

# Step 4: Batch Sync
dws teambition generate-sync-payload \
  --tasks-json '<step1-output>' \
  --project-id <pid> \
  --tasklist-id <tid> \
  --stage-map-json '{"1":"xxx","2":"yyy",...}'

# Step 5: Verify
dws teambition query-task-stats --user-id <id> --project-id <pid>
```

---

## Browser API: Stage & Type Changes

DingTalk OpenAPI does NOT support task stage movement or type (templateId) changes.
Use the generated browser scripts:

```bash
# Move task to a different stage
dws teambition generate-move-task-stage-payload \
  --task-id <tid> \
  --project-id <pid> \
  --target-stage-id <sid>

# Change task type
dws teambition generate-change-task-type-payload \
  --task-id <tid> \
  --project-id <pid> \
  --template-id <templateId>
```

Paste the generated JS into browser console (F12) or use with Playwright `page.evaluate()`.

---

## 定义任务类型 (Task Type Definition Workflow)

Task types (`scenariofieldconfigId` / `templateId`) determine what custom fields and workflows a task has. The DingTalk OpenAPI does NOT expose task type creation — use the browser API workflow below.

### Discovery: List Existing Types

```bash
# Quick aggregation (no browser, uses DingTalk API)
dws teambition query-task-types --user-id <id> --project-id <pid>

# Full details (name, icon, custom fields) — browser required
dws teambition generate-query-task-types-payload --project-id <pid>
# Run output JS in F12 console or via Playwright
```

### Create One Task Type

```bash
dws teambition generate-create-task-type-payload \
  --project-id <pid> \
  --name "需求" \
  --icon "story" \
  --base-template-id <existing-type-id>   # optional: inherits fields/workflow
```

Run output JS in browser. Returns the new `scenariofieldconfigId`.

### Batch Setup: 9 Standard R&D Types

```bash
# Default: 任务/需求/风险/审核/设计/质量/合同/变更/改善
dws teambition generate-setup-standard-task-types-payload --project-id <pid>

# Custom set
dws teambition generate-setup-standard-task-types-payload \
  --project-id <pid> \
  --custom-types '[{"name":"缺陷","icon":"bug"},{"name":"需求","icon":"story"}]'
```

The script:
- Skips types that already exist (idempotent)
- Reuses the project's default `taskflowId`
- Returns `{name → scenariofieldconfigId}` map

### Use New Types

After creation, pass the `scenariofieldconfigId` when creating tasks:

```bash
dws teambition create-task \
  --user-id <id> --project-id <pid> \
  --content "新需求 - 用户登录优化" \
  --task-type-id <scenariofieldconfigId>
```

Or change existing task's type:

```bash
dws teambition generate-change-task-type-payload \
  --task-id <tid> --project-id <pid> \
  --template-id <new-scenariofieldconfigId>
```

### Common Icons

`task` (任务), `bug` (缺陷), `story` (需求), `milestone` (里程碑), `risk` (风险), `design` (设计), `qaqc` (质量), `legal` (合同), `change` (变更), `improve` (改善)

---

## Browser Automation: opencli (Recommended) / Playwright (Legacy)

```javascript
// 1. Navigate
page.goto('https://www.teambition.com/project/{pid}')

// 2. Create task groups (16 stages)
for (const name of [...16 names...]) {
  click "新建任务列表"
  fill placeholder="列表名称" with name
  press Enter
}

// 3. Get stage IDs
const stages = await page.evaluate(async (pid) => {
  const r = await fetch(`/api/tasklists?_projectId=${pid}`)
  const data = await r.json()
  return Object.fromEntries(
    data[0].hasStages
      .filter(s => /^\d+\./.test(s.name))
      .map(s => [s.name.match(/^(\d+)/)[1], s._id])
  )
}, PID)

// 4. Move task to different stage
await page.evaluate(async (taskId, projectId, stageId) => {
  await fetch('https://www.teambition.com/api/task/update', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ _id: taskId, _projectId: projectId, _stageId: stageId })
  })
}, TASK_ID, PROJECT_ID, STAGE_ID)

// 5. Change task type
await page.evaluate(async (taskId, projectId, templateId) => {
  await fetch('https://www.teambition.com/api/task/update', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ _id: taskId, _projectId: projectId, templateId })
  })
}, TASK_ID, PROJECT_ID, templateId)
```

## Task Priority Reference

| Value | Meaning |
|-------|---------|
| `-10` | Low |
| `0` | Normal (default) |
| `1` | Urgent |
| `2` | Critical |


## API Limitations

- **Task stage movement**: NOT supported by DingTalk OpenAPI. Use `create-task --stage-id` to place tasks correctly from the start.
- **Task type change**: Unstable via API. Set `--task-type-id` at creation time.
- **Task list creation**: Requires browser API (opencli browser eval or F12 console).
