# dws-teambition

DWS plugin for Teambition project management via DingTalk OpenAPI.

Full task lifecycle management — create, read, update, delete with field-level control — plus reproducible bulk-sync workflows from Excel, JSON, CSV, or plain-text task lists.

## Quick Start

### 1. Install DWS CLI

```bash
npm i -g dingtalk-workspace-cli
```

### 2. Create a DingTalk Enterprise App

1. Go to [open-dev.dingtalk.com](https://open-dev.dingtalk.com)
2. Create an **Internal Enterprise App** (企业内部应用)
3. Grant permissions: `qyapi_project`, `Project.Task.Write.All`, `Project.Task.Read.All`
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

### 5. (Optional) Install opencli for Browser Automation

```bash
npm install -g @jackwener/opencli
```

### 6. Verify It Works

```bash
# Get your org ID
dws teambition get-organization --user-id <your-user-id>

# Create a project
dws teambition create-project --user-id <id> --name "My Project"

# Create a task
dws teambition create-task --user-id <id> --project-id <pid> --content "Hello"

# Query tasks
dws teambition query-tasks --user-id <id> --project-id <pid> --query "isDone = false"
```

Full command reference below.

## Commands

### Project & Org (8)

| Command | Description |
|---------|-------------|
| `get-organization` | Get Teambition organization ID |
| `create-project` | Create a new project |
| `query-projects` | Query all projects (name fuzzy search + pagination) |
| `get-user-join-projects` | Get IDs of projects user joined |
| `get-project-members` | List project members and roles |
| `add-project-members` | Batch add members (max 10) |
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

### Task Update (10)

| Command | Description |
|---------|-------------|
| `update-task-content` | Update task title |
| `update-task-executor` | Reassign task |
| `update-task-due-date` | Update due date |
| `update-task-start-date` | Update start date |
| `update-task-priority` | Update priority |
| `update-task-note` | Update note |
| `update-task-workflow-status` | Update workflow status (mark done) |
| `update-task-custom-fields` | Update custom field values |
| `update-task-participants` | Add/remove participants |
| `update-task-batch` | Batch update multiple fields in one call |

### Query & Stats (3)

| Command | Description |
|---------|-------------|
| `query-task-workflow-statuses` | List workflow statuses |
| `query-project-stages` | List stages with task counts |
| `query-task-stats` | Task stats by type/priority |

### Task Sync (3)

| Command | Description |
|---------|-------------|
| `parse-tasks` | Parse input (Excel/JSON/CSV/text), auto-classify into task types |
| `generate-sync-payload` | Generate browser batch-create payload |
| `query-task-stats` | Verify sync results |

### Task Types (4)

| Command | Description |
|---------|-------------|
| `query-task-types` | List existing task types via DingTalk aggregation |
| `generate-query-task-types-payload` | Browser JS to fetch full type info (name, icon, fields) |
| `generate-create-task-type-payload` | Browser JS to create one new task type |
| `generate-setup-standard-task-types-payload` | Browser JS to batch-create 9 R&D types |

### Stage & Type (Browser API) (2)

| Command | Description |
|---------|-------------|
| `generate-move-task-stage-payload` | Move task to different stage |
| `generate-change-task-type-payload` | Change task type/template |

## Browser Operations

Some Teambition features have no DingTalk OpenAPI — they require browser-side execution. Use **opencli** (recommended) or Playwright.

### opencli

Reuses your Chrome login session. No separate auth needed.

```bash
npm install -g @jackwener/opencli

# Open project
opencli browser open "https://www.teambition.com/project/<pid>"

# Run authenticated JS
opencli browser eval "(async () => { /* your code */ })()"

# Close
opencli browser close
```

| Feature | opencli | Playwright |
|---------|---------|------------|
| Auth | Reuses Chrome session | Requires separate login |
| Setup | `npm install -g` | `pip install` + browser binary |
| Speed | Instant (no launch) | Slow (new browser) |

### Stage Movement & Type Changes

Moving tasks between stages and changing task types are **not supported** by DingTalk OpenAPI. Use generated browser scripts:

```bash
# Move task to a different stage
dws teambition generate-move-task-stage-payload \
  --task-id <tid> --project-id <pid> --target-stage-id <sid>

# Change task type
dws teambition generate-change-task-type-payload \
  --task-id <tid> --project-id <pid> --template-id <id>
```

Paste the output into F12 Console on the project page, or pipe through opencli.

> **Tip:** Create tasks directly in the correct stage with `create-task --stage-id <sid>`. Set the type at creation time with `--task-type-id <id>`.

## Task Types

Task types define custom fields and workflows. The plugin supports the full discovery + creation cycle:

```bash
# Step 1: Discover existing types
dws teambition query-task-types --user-id <id> --project-id <pid>

# Step 2: Get full details via browser
dws teambition generate-query-task-types-payload --project-id <pid>
# → run the JS in browser

# Step 3a: Create one new type
dws teambition generate-create-task-type-payload \
  --project-id <pid> --name "需求" --icon "story"

# Step 3b: Bulk-create 9 standard R&D types
dws teambition generate-setup-standard-task-types-payload --project-id <pid>

# Step 3c: Bulk-create with custom types
dws teambition generate-setup-standard-task-types-payload \
  --project-id <pid> \
  --custom-types '[{"name":"缺陷","icon":"bug"},{"name":"需求","icon":"story"}]'

# Step 4: Use new types when creating tasks
dws teambition create-task \
  --user-id <id> --project-id <pid> \
  --content "新需求" \
  --task-type-id <scenariofieldconfigId-from-step-3>
```

Steps 2-3 produce browser JS. Run in F12 console or via `opencli browser eval`.

## Task Sync

Import tasks from any structured source. The parser auto-detects format and classifies tasks by type (milestone, task, risk, design, qaqc, etc.).

**Supported input formats:**

| Format | Example |
|--------|---------|
| Excel `.xlsx` | `研发流程清单.xlsx` |
| JSON | `[{"sn":1,"content":"塑胶件开模","type":"task","priority":1}]` |
| CSV | `sn,content,type,priority` rows |
| Plain text | One task per line, `[type] task description` |

```bash
# Step 1: Parse & classify (works with any supported format)
dws teambition parse-tasks --input "tasks.xlsx"
dws teambition parse-tasks --input "tasks.json"
dws teambition parse-tasks --input "tasks.csv"
dws teambition parse-tasks --input "tasks.txt"

# Step 2: Create project
dws teambition create-project --user-id <id> --name "My Project"

# Step 3: Setup task groups (browser required for stage creation)

# Step 4: Batch sync
dws teambition generate-sync-payload \
  --tasks-json '<step1-output>' \
  --project-id <pid> --tasklist-id <tid> \
  --stage-map-json '{"1":"xxx","2":"yyy",...}'

# Step 5: Verify
dws teambition query-task-stats --user-id <id> --project-id <pid>
```

## Switching Organizations

To use a different DingTalk organization's Teambition:

1. Create a new internal enterprise app in the target org at [open-dev.dingtalk.com](https://open-dev.dingtalk.com)
2. Grant the same permissions
3. Set new credentials:

```bash
export DWS_CLIENT_ID=<target-org-app-key>
export DWS_CLIENT_SECRET=<target-org-app-secret>
```

No code changes needed. Works identically across all editions.

## Task Priority

| Value | Meaning |
|-------|---------|
| `-10` | Low |
| `0` | Normal (default) |
| `1` | Urgent |
| `2` | Critical |

## TQL Examples

```
isDone = false
priority >= 1
executorId = "xxx"
executorId = "xxx" AND isDone = false
taskId = "62c25e3bbaxxx"
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
