import { getAccessToken, getRefreshToken, refreshAccessToken } from "@/lib/auth";

export const BACKEND_ROOT_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? `${BACKEND_ROOT_URL}/api/v1`;

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
  _isRetry = false,
): Promise<T> {
  const { body, headers, ...rest } = options;
  const accessToken = getAccessToken();

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !_isRetry && getRefreshToken()) {
    const newAccessToken = await refreshAccessToken();
    if (newAccessToken) {
      return apiFetch<T>(path, options, true);
    }
  }

  if (!res.ok) {
    let parsedBody: unknown = null;
    try {
      parsedBody = await res.json();
    } catch {
      // response had no JSON body
    }
    throw new ApiError(res.status, parsedBody);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}
