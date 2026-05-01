---
name: teambition
description: Manage Teambition projects and tasks through DingTalk OpenAPI
cli_version: ">=v1.0.18"
---

# Teambition (项目管理)

通过钉钉开放平台的 Teambition 项目管理 API，管理项目、任务。

## 前置条件

1. 在[钉钉开放平台](https://open-dev.dingtalk.com)创建企业内部应用
2. 开通以下权限点：
   - `qyapi_project` — 项目管理基础权限
   - `Project.Task.Write.All` — 任务写权限
   - `Project.Task.Read.All` — 任务读权限
3. 设置环境变量：
   ```bash
   export DWS_CLIENT_ID=<AppKey>
   export DWS_CLIENT_SECRET=<AppSecret>
   ```

## Intent Recognition

Use this skill when the user mentions:
- Teambition 项目管理、Teambition 任务
- 创建项目、创建任务、查询任务
- project management, task management
- 钉钉项目

## Command Decision Tree

| User Intent | Tool | CLI Flags |
|-------------|------|-----------|
| 获取企业 ID | `get_organization` | `--user-id <id>` |
| 创建项目 | `create_project` | `--user-id <id> --name <name>` |
| 创建任务 | `create_task` | `--user-id <id> --project-id <id> --content <title> [--executor-id <id> --priority <n> --due-date <iso> --note <text>]` |
| 查询任务 | `query_tasks` | `--user-id <id> --project-id <id> [--query <TQL> --max-results <n>]` |
| 归档任务 | `archive_task` | `--user-id <id> --task-id <id>` |
| 删除任务 | `delete_task` | `--user-id <id> --task-id <id> --project-id <id>` |

## Parameter Rules

### priority
- `-10`: 低优先级
- `0`: 普通优先级 (默认)
- `1`: 紧急
- `2`: 非常紧急

### dueDate
- 格式: ISO 8601，如 `2026-05-10T18:00:00+08:00`

### query (TQL)
- 常用条件: `isDone = false`, `priority >= 1`, `executorId = "xxx"`
- 多个条件用 `AND` 连接

## Workflow Examples

### 完整流程：从零创建项目并添加任务
1. `get_organization` → 获取 `tbOrganizationId`
2. `create_project` → 获取 `projectId`
3. `create_task` → 创建任务，获取 `taskId`
4. `query_tasks` → 验证任务已创建
