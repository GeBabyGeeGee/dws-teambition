import { formatResponse } from "../lib/utils.js";

export async function handleGenerateQueryTaskTypesPayload(args: Record<string, unknown>) {
  const projectId = args.project_id as string;

  const jsPayload = `
(async () => {
  const PROJECT_ID = "${projectId}";
  try {
    const res = await fetch(\`/api/scenariofieldconfigs?_projectId=\${PROJECT_ID}&_objectType=task\`, {
      method: "GET", headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    const types = Array.isArray(data) ? data : (data.result || []);
    const summary = types.map((t) => ({
      scenariofieldconfigId: t._id, name: t.name, icon: t.icon,
      isDefault: !!t.isDefault, taskflowId: t.taskflowId,
      proTemplateConfigType: t.proTemplateConfigType,
      customfieldCount: (t.customfields || []).length,
      customfields: (t.customfields || []).map((cf) => ({
        cfId: cf.cfId, fieldType: cf.fieldType, required: cf.required, displayed: cf.displayed,
      })),
    }));
    console.log("Task Types:", summary);
    return summary;
  } catch (e) {
    console.error("Failed:", e);
    return { error: e.message };
  }
})();
`;

  return formatResponse({
    instructions: "Browser-executable script. Run on Teambition while logged in.",
    project_id: projectId,
    js_payload: jsPayload,
    notes: [
      "Result includes scenariofieldconfigId (use as task_type_id when creating tasks)",
      "Each type's customfields array shows what fields belong to that type",
      "taskflowId can be used to query workflow statuses for that type",
    ],
  });
}

export async function handleGenerateCreateTaskTypePayload(args: Record<string, unknown>) {
  const projectId = args.project_id as string;
  const name = args.name as string;
  const icon = (args.icon as string) || "task";
  const baseTemplateId = (args.base_template_id as string) || "";

  const jsPayload = `
(async () => {
  const PROJECT_ID = "${projectId}";
  const NAME = ${JSON.stringify(name)};
  const ICON = ${JSON.stringify(icon)};
  const BASE_ID = ${JSON.stringify(baseTemplateId)};

  try {
    let body = { _projectId: PROJECT_ID, name: NAME, icon: ICON, objectType: "task" };
    if (BASE_ID) {
      const baseRes = await fetch(\`/api/scenariofieldconfigs/\${BASE_ID}\`);
      const baseData = await baseRes.json();
      body.taskflowId = baseData.taskflowId;
      body.customfields = baseData.customfields || [];
      body.proTemplateConfigType = baseData.proTemplateConfigType;
    }
    const res = await fetch("/api/scenariofieldconfigs", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log("Task type created:", data);
    return { scenariofieldconfigId: data._id, name: data.name, icon: data.icon, taskflowId: data.taskflowId };
  } catch (e) {
    console.error("Failed to create task type:", e);
    return { error: e.message };
  }
})();
`;

  return formatResponse({
    instructions: "Browser-executable script. Run on Teambition while logged in.",
    project_id: projectId, name, icon,
    base_template_id: baseTemplateId || null,
    js_payload: jsPayload,
    notes: [
      "After creation, the new scenariofieldconfigId can be used in create_task",
      "If base_template_id is provided, the new type inherits its custom fields and workflow",
    ],
  });
}

export async function handleGenerateSetupStandardTaskTypesPayload(args: Record<string, unknown>) {
  const projectId = args.project_id as string;
  const customTypes = args.custom_types as Array<{ name: string; icon?: string }> | undefined;

  const defaultTypes = [
    { name: "任务", icon: "task" },
    { name: "需求", icon: "story" },
    { name: "风险", icon: "risk" },
    { name: "审核", icon: "milestone" },
    { name: "设计", icon: "design" },
    { name: "质量", icon: "qaqc" },
    { name: "合同", icon: "legal" },
    { name: "变更", icon: "change" },
    { name: "改善", icon: "improve" },
  ];

  const types = customTypes && customTypes.length > 0 ? customTypes : defaultTypes;

  const jsPayload = `
(async () => {
  const PROJECT_ID = "${projectId}";
  const TYPES = ${JSON.stringify(types)};

  let existingTypes = [];
  let defaultTaskflowId = null;
  try {
    const r = await fetch(\`/api/scenariofieldconfigs?_projectId=\${PROJECT_ID}&_objectType=task\`);
    existingTypes = await r.json();
    if (Array.isArray(existingTypes) && existingTypes.length > 0) {
      defaultTaskflowId = existingTypes[0].taskflowId;
    }
  } catch (e) { console.warn("Could not fetch existing types:", e); }

  const existingNames = new Set(existingTypes.map((t) => t.name));
  const created = [], skipped = [], errors = [];

  for (const t of TYPES) {
    if (existingNames.has(t.name)) { skipped.push(t.name); continue; }
    try {
      const body = { _projectId: PROJECT_ID, name: t.name, icon: t.icon || "task", objectType: "task" };
      if (defaultTaskflowId) body.taskflowId = defaultTaskflowId;
      const res = await fetch("/api/scenariofieldconfigs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      created.push({ name: t.name, scenariofieldconfigId: data._id });
      await new Promise((r) => setTimeout(r, 200));
    } catch (e) { errors.push({ name: t.name, error: e.message }); }
  }

  console.log("Setup complete:", { created, skipped, errors });
  return { created, skipped, errors };
})();
`;

  return formatResponse({
    instructions: "Browser-executable script. Run on Teambition while logged in.",
    project_id: projectId,
    types_to_create: types,
    js_payload: jsPayload,
    notes: [
      "Skips types that already exist in the project",
      "Reuses the default taskflowId from existing types",
      "Returns map of {name → scenariofieldconfigId} for created types",
    ],
  });
}
