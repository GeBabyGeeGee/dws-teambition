# dws-teambition

DWS plugin for Teambition project management via DingTalk OpenAPI.

Manage your Teambition projects and tasks directly from the command line with `dws teambition`.

## Quick Start

### 1. Install DWS CLI

```bash
npm i -g dingtalk-workspace-cli
```

### 2. Create a DingTalk Enterprise App

1. Go to [open-dev.dingtalk.com](https://open-dev.dingtalk.com)
2. Create an **Internal Enterprise App** (企业内部应用)
3. Grant these permissions:
   - `qyapi_project` — Project Management
   - `Project.Task.Write.All` — Task write
   - `Project.Task.Read.All` — Task read
4. Get your **AppKey** and **AppSecret**

### 3. Install the Plugin

```bash
dws plugin install --git https://github.com/YOUR_USER/dws-teambition
```

Or locally:

```bash
git clone https://github.com/YOUR_USER/dws-teambition
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

# Create a task
dws teambition create-task \
  --user-id <id> \
  --project-id <pid> \
  --content "Important task" \
  --priority 1 \
  --due-date "2026-05-10T18:00:00+08:00" \
  --note "Task description"

# Query tasks with TQL filter
dws teambition query-tasks \
  --user-id <id> \
  --project-id <pid> \
  --query "isDone = false" \
  --max-results 50

# Archive a task
dws teambition archive-task --user-id <id> --task-id <tid>

# Delete a task
dws teambition delete-task --user-id <id> --task-id <tid> --project-id <pid>
```

## Commands

| Command | Description |
|---------|-------------|
| `get-organization` | Get Teambition organization ID |
| `create-project` | Create a new project |
| `create-task` | Create a task (supports priority, due date, executor, note) |
| `query-tasks` | Query tasks with TQL filter |
| `archive-task` | Archive a task (move to trash) |
| `delete-task` | Permanently delete a task |

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
```

## Cross-Platform Usage

DWS CLI and this plugin work on **Windows, macOS, and Linux**.

1. Install DWS: `npm i -g dingtalk-workspace-cli`
2. Set credentials: `export DWS_CLIENT_ID=... DWS_CLIENT_SECRET=...`
3. Install this plugin
4. Done — same commands everywhere

## Building from Source

```bash
git clone https://github.com/YOUR_USER/dws-teambition
cd dws-teambition
npm install
bun build --compile src/server.ts --outfile bin/server
dws plugin dev .
```

## License

MIT
