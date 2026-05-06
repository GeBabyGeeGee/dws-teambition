import { formatResponse } from "./utils.js";

export async function handleGenerateMoveTaskStagePayload(args: Record<string, unknown>) {
  const taskId = args.task_id as string;
  const projectId = args.project_id as string;
  const targetStageId = args.target_stage_id as string;
  const tasklistId = (args.target_tasklist_id as string) || "";

  const jsPayload = `
// Copy-paste this into browser console (F12) while on Teambition project page
// Or use with Playwright page.evaluate()
// Moves task to a different stage/tasklist

(async () => {
  const TASK_ID = "${taskId}";
  const PROJECT_ID = "${projectId}";
  const TARGET_STAGE_ID = "${targetStageId}";
  const TASKLIST_ID = "${tasklistId}";

  const body = { _id: TASK_ID, _projectId: PROJECT_ID, _stageId: TARGET_STAGE_ID };
  if (TASKLIST_ID) body._tasklistId = TASKLIST_ID;

  try {
    const res = await fetch("https://www.teambition.com/api/tasks/" + TASK_ID, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log("Task moved:", data);
    return data;
  } catch (e) {
    console.error("Failed to move task:", e);
    return { error: e.message };
  }
})();
`;

  return formatResponse({
    instructions: "Browser-executable script. Run via opencli browser eval or F12 console.",
    task_id: taskId,
    project_id: projectId,
    target_stage_id: targetStageId,
    js_payload: jsPayload,
  });
}

export async function handleGenerateChangeTaskTypePayload(args: Record<string, unknown>) {
  const taskId = args.task_id as string;
  const projectId = args.project_id as string;
  const templateId = args.template_id as string;

  const jsPayload = `
(async () => {
  const TASK_ID = "${taskId}";
  const PROJECT_ID = "${projectId}";
  const TEMPLATE_ID = "${templateId}";

  try {
    const res = await fetch("https://www.teambition.com/api/tasks/" + TASK_ID, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _id: TASK_ID, _projectId: PROJECT_ID, templateId: TEMPLATE_ID }),
    });
    const data = await res.json();
    console.log("Task type changed:", data);
    return data;
  } catch (e) {
    console.error("Failed:", e);
    return { error: e.message };
  }
})();
`;

  return formatResponse({
    instructions: "Browser-executable script. Run via opencli browser eval or F12 console.",
    task_id: taskId,
    project_id: projectId,
    template_id: templateId,
    js_payload: jsPayload,
  });
}

export async function handleGenerateSyncPayload(args: Record<string, unknown>) {
  const tasks = JSON.parse(args.tasks_json as string);
  const projectId = args.project_id as string;
  const tasklistId = args.tasklist_id as string;
  const stageMap: Record<string, string> = JSON.parse(args.stage_map_json as string);

  const jsPayload = `
(async () => {
  const STAGES = ${JSON.stringify(stageMap)};
  const PID = "${projectId}";
  const TID = "${tasklistId}";
  const TASKS = ${JSON.stringify(tasks)};

  let created = 0, errors = 0;
  for (const t of TASKS) {
    const stageId = STAGES[t.sn] || Object.values(STAGES)[0];
    try {
      await fetch("https://www.teambition.com/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: t.content, _projectId: PID, _tasklistId: TID, _stageId: stageId, priority: t.priority, note: t.note }),
      });
      created++;
    } catch(e) { errors++; }
    if (created % 10 === 0) await new Promise(r => setTimeout(r, 300));
  }
  console.log(\`Created: \${created}, Errors: \${errors}\`);
  return { created, errors };
})();
`;

  return formatResponse({
    instructions: "Browser-executable script. Run via opencli browser eval or F12 console.",
    total_tasks: tasks.length,
    stage_count: Object.keys(stageMap).length,
    js_payload: jsPayload,
  });
}

// ---- Tasklist & Stage Management (Browser API only) ----

export async function handleGenerateCreateTasklistPayload(args: Record<string, unknown>) {
  const projectId = args.project_id as string;
  const name = args.name as string;

  const jsPayload = `
// Creates a new tasklist (task group) in the project
// Each tasklist comes with one default stage
(async () => {
  const PID = "${projectId}";
  const NAME = ${JSON.stringify(name)};

  try {
    const res = await fetch("https://www.teambition.com/api/tasklists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: NAME, _projectId: PID, isArchived: false }),
    });
    const data = await res.json();
    const stageId = data.stageIds?.[0] || null;
    console.log("Tasklist created:", data);
    return { tasklistId: data._id, stageId, name: data.title };
  } catch (e) {
    console.error("Failed:", e);
    return { error: e.message };
  }
})();
`;

  return formatResponse({
    instructions: "Browser-executable script. Creates a new tasklist with one default stage.",
    project_id: projectId,
    name,
    js_payload: jsPayload,
    notes: [
      "Each new tasklist comes with one default stage named '未分类'",
      "Use stageId from the result for creating tasks in this tasklist",
      "Use generate_rename_stage_payload to rename the default stage",
    ],
  });
}

export async function handleGenerateRenameStagePayload(args: Record<string, unknown>) {
  const stageId = args.stage_id as string;
  const newName = args.new_name as string;

  const jsPayload = `
// Renames a stage (column) within a tasklist
(async () => {
  const SID = "${stageId}";
  const NAME = ${JSON.stringify(newName)};

  try {
    const res = await fetch(\`https://www.teambition.com/api/stages/\${SID}\`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: NAME }),
    });
    const data = await res.json();
    console.log("Stage renamed:", data);
    return { stageId: data._id, name: data.name };
  } catch (e) {
    console.error("Failed:", e);
    return { error: e.message };
  }
})();
`;

  return formatResponse({
    instructions: "Browser-executable script. Renames a stage column.",
    stage_id: stageId,
    new_name: newName,
    js_payload: jsPayload,
    notes: [
      "Stage IDs can be found via the tasklists API: GET /api/tasklists?_projectId=<pid>",
      "Common use: rename default '未分类' stage to a meaningful name",
    ],
  });
}

export async function handleGenerateDeleteTasklistPayload(args: Record<string, unknown>) {
  const tasklistId = args.tasklist_id as string;

  const jsPayload = `
// Deletes a tasklist AND all its tasks (WARNING: irreversible)
(async () => {
  const TLID = "${tasklistId}";
  
  if (!confirm(\`Delete tasklist \${TLID} and ALL its tasks?\`)) {
    console.log("Cancelled.");
    return { cancelled: true };
  }

  try {
    const res = await fetch(\`https://www.teambition.com/api/tasklists/\${TLID}\`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    console.log("Tasklist deleted:", data);
    return { deleted: true, tasklistId: data._id };
  } catch (e) {
    console.error("Failed:", e);
    return { error: e.message };
  }
})();
`;

  return formatResponse({
    instructions: "Browser-executable script. DELETES a tasklist and all its tasks. This is IRREVERSIBLE.",
    tasklist_id: tasklistId,
    js_payload: jsPayload,
    warnings: [
      "This will permanently delete the tasklist AND all tasks within it",
      "A confirmation dialog will appear in the browser",
      "Tasklist IDs can be found via GET /api/tasklists?_projectId=<pid>",
    ],
  });
}

export async function handleGenerateBatchCreateTasklistsPayload(args: Record<string, unknown>) {
  const projectId = args.project_id as string;
  const names_json = args.names_json as string;
  const names: string[] = JSON.parse(names_json);

  const jsPayload = `
// Batch creates multiple tasklists with one default stage each
(async () => {
  const PID = "${projectId}";
  const NAMES = ${JSON.stringify(names)};
  const results = {};

  for (const name of NAMES) {
    try {
      const res = await fetch("https://www.teambition.com/api/tasklists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name, _projectId: PID, isArchived: false }),
      });
      const data = await res.json();
      results[name] = { tasklistId: data._id, stageId: data.stageIds?.[0] || null };
      console.log(\`Created: \${name} → \${data._id}\`);
    } catch (e) {
      results[name] = { error: e.message };
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log("Batch complete:", results);
  return results;
})();
`;

  return formatResponse({
    instructions: "Browser-executable script. Creates multiple tasklists at once.",
    project_id: projectId,
    names,
    js_payload: jsPayload,
    notes: [
      "Each tasklist gets one default stage named '未分类'",
      "Returns a map of {name → {tasklistId, stageId}}",
      "200ms delay between creations to avoid rate limiting",
    ],
  });
}

export async function handleGenerateOpencliSetupPayload(args: Record<string, unknown>) {
  const projectId = args.project_id as string;
  const namesJson = (args.tasklist_names_json as string) || '["设计验证","系统验证","量产交付"]';

  const setupGuide = `# Teambition Project Setup via opencli Browser

## Step 1: Open project
opencli browser open "https://www.teambition.com/project/${projectId}"

## Step 2: Create task list groups
opencli browser eval "(async () => {
  const PID = '${projectId}';
  const names = ${namesJson};
  const results = {};
  for (const name of names) {
    const r = await fetch('https://www.teambition.com/api/tasklists', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({title: name, _projectId: PID, isArchived: false}),
    });
    const d = await r.json();
    results[name] = {tasklistId: d._id, stageId: d.stageIds?.[0]||null};
  }
  return JSON.stringify(results);
})()"

## Step 3: Create tasks in correct stages
dws teambition create-task --user-id <uid> --project-id ${projectId} --content "Task" --stage-id <stageId-from-step2>

## Step 4: Mark tasks as done
dws teambition query-task-workflow-statuses --user-id <uid> --project-id ${projectId}
dws teambition update-task-workflow-status --user-id <uid> --task-id <tid> --taskflow-status-id <done-status-id>
`;

  return formatResponse({
    instructions: "Complete opencli-based Teambition project setup workflow. opencli reuses Chrome login session - no credentials needed.",
    project_id: projectId,
    setup_guide: setupGuide,
    notes: [
      "opencli browser eval executes JS in the Teambition page context, reusing your login session",
      "Create tasks with --stage-id to place them in the correct task list from the start",
      "Task movement between stages is NOT supported by the DingTalk API - plan stage assignments upfront",
      "The delete+recreate workaround for moving tasks loses task history (comments, attachments)",
    ],
  });
}
