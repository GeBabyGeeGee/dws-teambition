import { apiCall } from "../lib/auth.js";
import { formatResponse } from "../lib/utils.js";

export async function handleGetOrganization(args: Record<string, unknown>) {
  const data = await apiCall("GET", "/v1.0/project/teambition/organizations", undefined, {
    optUserId: args.user_id as string,
  });
  return formatResponse(data);
}

export async function handleCreateProject(args: Record<string, unknown>) {
  const data = await apiCall("POST", `/v1.0/project/users/${args.user_id}/projects`, { name: args.name });
  return formatResponse(data);
}

export async function handleQueryProjects(args: Record<string, unknown>) {
  const params: Record<string, string> = {};
  if (args.name) params.name = args.name as string;
  if (args.max_results) params.maxResults = String(args.max_results);
  else params.maxResults = "50";
  if (args.next_token) params.nextToken = args.next_token as string;

  const data = await apiCall(
    "POST", `/v1.0/project/users/${args.user_id}/projects/query`, undefined, params
  );
  return formatResponse(data);
}

export async function handleGetUserJoinProjects(args: Record<string, unknown>) {
  const params: Record<string, string> = {};
  if (args.max_results) params.maxResults = String(args.max_results);

  const data = await apiCall(
    "GET", `/v1.0/project/users/${args.user_id}/joinProjects`, undefined, params
  );
  return formatResponse(data);
}

export async function handleGetProjectMembers(args: Record<string, unknown>) {
  const params: Record<string, string> = {};
  if (args.max_results) params.maxResults = String(args.max_results);
  else params.maxResults = "50";

  const data = await apiCall(
    "GET", `/v1.0/project/users/${args.user_id}/projects/${args.project_id}/members`, undefined, params
  );
  return formatResponse(data);
}

export async function handleAddProjectMembers(args: Record<string, unknown>) {
  const data = await apiCall(
    "POST", `/v1.0/project/users/${args.user_id}/projects/${args.project_id}/members`,
    { userIds: args.member_user_ids }
  );
  return formatResponse(data);
}

export async function handleRemoveProjectMembers(args: Record<string, unknown>) {
  const data = await apiCall(
    "POST", `/v1.0/project/users/${args.user_id}/projects/${args.project_id}/members/remove`,
    { userIds: args.member_user_ids }
  );
  return formatResponse(data);
}

export async function handleQueryProjectStatus(args: Record<string, unknown>) {
  const data = await apiCall(
    "GET", `/v1.0/project/users/${args.user_id}/projects/${args.project_id}/statuses`, undefined
  );
  return formatResponse(data);
}
