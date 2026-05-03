# dws-teambition

DWS plugin for Teambition project management via DingTalk OpenAPI.

Full task lifecycle management: create, read, update, delete with granular field-level control.
Plus reproducible Excel-to-Teambition sync workflow.

## Quick Start

### 1. Install DWS CLI

```bash
npm i -g dingtalk-workspace-cli
```

### 2. Create a DingTalk Enterprise App

1. Go to [open-dev.dingtalk.com](https://open-dev.dingtalk.com)
2. Create an **Internal Enterprise App** (企业内部应用)
3. Grant permissions:
   - `qyapi_project` — Project Management
   - `Project.Task.Write.All` — Task write
   - `Project.Task.Read.All` — Task read
4. Get your **AppKey** and **AppSecret**

### 3. Install the Plugin

```bash
dws plugin install --git https://github.com/GeBabyGeeGee/dws-teambition
```

Or locally:

```bash
git clone https://github.com/GeBabyGeeGee/dws-teambition
dws plugin dev ./dws-teambition
```

### 4. Configure Credentials

```bash
export DWS_CLIENT_ID=<your-app-key>
export DWS_CLIENT_SECRET=<your-app-secret>
```

### 5. Start Managing

```bash
# Get your organization ID
dws teambition get-organization --user-id <your-user-id>

# Create a project
dws teambition create-project --user-id <id> --name "My Project"

# Create a task (full field support)
dws teambition create-task \
  --user-id <id> \
  --project-id <pid> \
  --content "Important task" \
  --priority 1 \
  --due-date "2026-05-10T18:00:00Z" \
  --note "Task description" \
  --executor-id <uid> \
  --start-date "2026-05-01T09:00:00Z"

# Get task details
dws teambition get-task --user-id <id> --task-id <tid> --project-id <pid>

# Update task title
dws teambition update-task-content --user-id <id> --task-id <tid> --content "New Title"

# Reassign task
dws teambition update-task-executor --user-id <id> --task-id <tid> --executor-id <uid>

# Change priority
dws teambition update-task-priority --user-id <id> --task-id <tid> --priority 2

# Batch update multiple fields
dws teambition update-task-batch \
  --user-id <id> \
  --task-id <tid> \
  --content "Updated" \
  --priority 1 \
  --executor-id <uid> \
  --due-date "2026-12-31T18:00:00Z"

# Mark task as done
dws teambition query-task-workflow-statuses --user-id <id> --project-id <pid>
dws teambition update-task-workflow-status --user-id <id> --task-id <tid> --taskflow-status-id <sid>

# Update custom fields
dws teambition update-task-custom-fields \
  --user-id <id> \
  --task-id <tid> \
  --customfield-id <cfid> \
  --value '[{"title":"new value"}]'

# Add/remove participants
dws teambition update-task-participants --user-id <id> --task-id <tid> --add-involvers '["uid1","uid2"]'

# Query tasks with TQL
dws teambition query-tasks \
  --user-id <id> \
  --project-id <pid> \
  --query "isDone = false" \
  --max-results 50

# Archive / Delete
dws teambition archive-task --user-id <id> --task-id <tid>
dws teambition delete-task --user-id <id> --task-id <tid> --project-id <pid>
```

## Commands

### Project & Org (8)
| Command | Description |
|---------|-------------|
| `get-organization` | Get Teambition organization ID |
| `create-project` | Create a new project |
| `query-projects` | Query all projects (name fuzzy search + pagination) |
| `get-user-join-projects` | Get IDs of projects user joined |
| `get-project-members` | List project members and roles |
| `add-project-members` | Batch add members (max 10 at once) |
| `remove-project-members` | Batch remove members |
| `query-project-status` | Query project overview status (normal/risky/urgent) |

### Task CRUD (5)
| Command | Description |
|---------|-------------|
| `create-task` | Create task with full field support |
| `get-task` | Get single task details |
| `query-tasks` | Query tasks with TQL + pagination |
| `archive-task` | Archive task (move to trash) |
| `delete-task` | Permanently delete a task |

### Task Update (9 granular + 1 batch)
| Command | Description |
|---------|-------------|
| `update-task-content` | Update task title |
| `update-task-executor` | Update task executor |
| `update-task-due-date` | Update due date |
| `update-task-start-date` | Update start date |
| `update-task-priority` | Update priority |
| `update-task-note` | Update note |
| `update-task-workflow-status` | Update workflow status (mark done) |
| `update-task-custom-fields` | Update custom field values |
| `update-task-participants` | Add/remove participants |
| `update-task-batch` | Batch update multiple fields |

### Stage & Type (Browser API) (2)
| Command | Description |
|---------|-------------|
| `generate-move-task-stage-payload` | Move task to different stage |
| `generate-change-task-type-payload` | Change task type/template |

### Task Type Definition (定义任务类型) (4)
| Command | Description |
|---------|-------------|
| `query-task-types` | List existing task types in project (via DingTalk aggregation) |
| `generate-query-task-types-payload` | Browser JS to fetch full type info (name, icon, fields) |
| `generate-create-task-type-payload` | Browser JS to create one new task type |
| `generate-setup-standard-task-types-payload` | Browser JS to batch-create 9 R&D types (任务/需求/风险/审核/...) |

### Query & Stats (3)
| Command | Description |
|---------|-------------|
| `query-task-workflow-statuses` | List workflow statuses |
| `query-project-stages` | List stages with task counts |
| `query-task-stats` | Task stats by type/priority |

### Excel Sync (3)
| Command | Description |
|---------|-------------|
| `parse-excel` | Parse Excel, auto-classify |
| `generate-sync-payload` | Generate browser batch-create |
| `query-task-stats` | Verify sync results |

## Browser API: Stage & Type Changes

DingTalk OpenAPI does NOT support task stage movement or type (templateId) changes. Use the generated browser scripts:

```bash
# Move task to a different stage
dws teambition generate-move-task-stage-payload \
  --task-id <tid> --project-id <pid> --target-stage-id <sid>

# Change task type
dws teambition generate-change-task-type-payload \
  --task-id <tid> --project-id <pid> --template-id <templateId>
```

Paste the generated JS into browser console (F12) or use with Playwright `page.evaluate()`.

## Defining Task Types (定义任务类型)

Task types (`scenariofieldconfigId`) define what custom fields and workflows a task has. The plugin supports the full discovery + creation cycle:

```bash
# Step 1: Discover existing task types in your project
dws teambition query-task-types --user-id <id> --project-id <pid>
# Returns: list of scenariofieldconfigIds with sample tasks and counts

# Step 2: Get FULL details (name, icon, custom fields) via browser
dws teambition generate-query-task-types-payload --project-id <pid>
# Run the JS in browser → returns detailed info including custom field definitions

# Step 3a: Create ONE new task type
dws teambition generate-create-task-type-payload \
  --project-id <pid> \
  --name "需求" \
  --icon "story" \
  --base-template-id <existing-id>   # optional: copy fields/workflow from existing type

# Step 3b: Bulk-setup 9 standard R&D task types (任务/需求/风险/审核/设计/质量/合同/变更/改善)
dws teambition generate-setup-standard-task-types-payload --project-id <pid>

# Step 3c: Bulk-setup with custom types
dws teambition generate-setup-standard-task-types-payload \
  --project-id <pid> \
  --custom-types '[{"name":"缺陷","icon":"bug"},{"name":"需求","icon":"story"}]'

# Step 4: Use the new types when creating tasks
dws teambition create-task \
  --user-id <id> --project-id <pid> \
  --content "新需求" \
  --task-type-id <scenariofieldconfigId-from-step-3>
```

**Note**: Steps 2-3 produce browser-executable JS. Run them on `https://www.teambition.com/project/<pid>` in F12 console, or via Playwright `page.evaluate()`.

## Excel → Teambition Sync Workflow

```bash
# Step 1: Parse & Classify
dws teambition parse-excel --file-path "研发流程清单.xlsx"
# Output: 92 tasks classified into 9 types (milestone/risk/design/qaqc/...)

# Step 2: Create Project
dws teambition create-project --user-id <id> --name "项目名称"

# Step 3: Setup Task Groups (Browser required)
# Use Playwright to create 16 stage groups and capture stage IDs

# Step 4: Batch Sync
dws teambition generate-sync-payload \
  --tasks-json '<step1-output>' \
  --project-id <pid> --tasklist-id <tid> \
  --stage-map-json '{"1":"xxx","2":"yyy",...}'

# Step 5: Verify
dws teambition query-task-stats --user-id <id> --project-id <pid>
```

## Switching Organizations (e.g. Free → Flagship)

To use a different DingTalk organization's Teambition:

1. Create a new internal enterprise app in the target org at [open-dev.dingtalk.com](https://open-dev.dingtalk.com)
2. Grant the same permissions
3. Set new credentials:
```bash
export DWS_CLIENT_ID=<flagship-org-app-key>
export DWS_CLIENT_SECRET=<flagship-org-app-secret>
```

No code changes needed — the plugin works identically across all editions.

## Task Priority

| Value | Meaning |
|-------|---------|
| `-10` | Low |
| `0` | Normal (default) |
| `1` | Urgent |
| `2` | Critical |

## TQL Examples

```
isDone = false                          -- Unfinished tasks
priority >= 1                           -- High priority tasks
executorId = "xxx"                      -- Tasks assigned to user
executorId = "xxx" AND isDone = false   -- Pending tasks for user
taskId = "62c25e3bbaxxx"               -- Specific task by ID
```

## Building from Source

```bash
git clone https://github.com/GeBabyGeeGee/dws-teambition
cd dws-teambition
npm install
bun build --compile src/server.ts --outfile bin/server
dws plugin dev .
```

## License

MIT
