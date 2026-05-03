export function formatResponse(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorResponse(msg: string) {
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}
