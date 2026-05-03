# Workflow: Excel → Teambition Sync

**Version**: 1.0.0
**Last Run**: 2026-05-01
**Status**: Verified

## Purpose

Reproducible pipeline to sync an R&D process Excel checklist into a Teambition project with proper stage grouping and task classification.

## Input

- Excel file with 10 columns (SN, Stage, InputDept, InputReq, OutputDept, Owner, Reviewer, Deliverable, KeyNode, Notes)
- DingTalk app credentials (AppKey/AppSecret)
- DWS CLI + teambition plugin installed

## Steps

### 1. Parse & Classify

**Tool**: `dws teambition parse-excel --file-path "<excel-path>"`

- Parses Excel via Python openpyxl
- Classifies each deliverable into: milestone, risk, design, qaqc, requirement, legal, change, improve, task
- Assigns priority based on type
- Outputs JSON task list (92 tasks, 16 stages)

**Verification**: JSON output has `total_tasks`, `type_summary`, `stage_summary` fields

### 2. Create Project

**Tool**: `dws teambition create-project --user-id <id> --name "<name>"`

- Creates project via DingTalk API
- Returns `projectId`, `rootCollectionId`, `defaultCollectionId`

**Verification**: Project visible at `https://www.teambition.com/project/{projectId}`

### 3. Setup Task Groups

**Tool**: Playwright browser automation

- Opens Teambition project in browser
- Creates 16 task groups (stage columns)
- Captures stage IDs via browser API

**Verification**: 17 stages visible (1 default + 16 new), 0 tasks in each

### 4. Batch Create Tasks

**Tool**: Browser API `POST /api/tasks` with `_stageId`

- Creates 92 tasks in correct stage groups
- Each task has: type prefix, priority, detailed note
- Stage headers serve as group separators

**Verification**: Query shows 92 tasks distributed across 16 stages, 0 in "未分类"

### 5. Validate

**Tool**: `dws teambition query-task-stats --user-id <id> --project-id <pid>`

- Confirms task count and distribution
- Checks type and priority breakdown

## Dependencies

- DWS CLI v1.0.18+
- dws-teambition plugin v0.3.0+
- Python 3 + openpyxl
- Playwright (for browser steps)

## Known Limitations

- DingTalk OpenAPI does not support task group/stage management
- Step 3 and Step 4 require browser automation (Playwright)
- Stage IDs are project-specific (cannot be reused across projects)
- No incremental sync yet (full rebuild each run)
