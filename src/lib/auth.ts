// Token management for DingTalk OpenAPI
const DINGTALK_API = "https://api.dingtalk.com";
const CLIENT_ID = process.env.DWS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DWS_CLIENT_SECRET || "";

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "Missing DWS_CLIENT_ID or DWS_CLIENT_SECRET. Set them via:\n" +
        "  export DWS_CLIENT_ID=<AppKey>\n" +
        "  export DWS_CLIENT_SECRET=<AppSecret>"
    );
  }
  const res = await fetch(`${DINGTALK_API}/v1.0/oauth2/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey: CLIENT_ID, appSecret: CLIENT_SECRET }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to get access token: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { accessToken: string; expireIn: number };
  cachedToken = {
    token: data.accessToken,
    expiresAt: Date.now() + data.expireIn * 1000,
  };
  return cachedToken.token;
}

export async function apiCall(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>
): Promise<unknown> {
  const token = await getAccessToken();
  let url = `${DINGTALK_API}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += `?${qs}`;
  }
  const res = await fetch(url, {
    method,
    headers: {
      "x-acs-dingtalk-access-token": token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }
  return JSON.parse(text);
}
