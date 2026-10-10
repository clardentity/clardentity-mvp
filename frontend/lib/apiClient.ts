import { getAccessToken, getRefreshToken, refreshAccessToken } from "@/lib/auth";
import { trackServerWait } from "@/lib/serverWait";

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

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  /** Skip the short-lived GET cache below. For anything that polls, or that
   *  is read immediately after something was written to it. */
  fresh?: boolean;
};

/* One answer per question, for a moment.
 *
 * Signing in used to spend eleven requests getting to a chat, five of them
 * repeats: the shell asks for the workspaces, so does the page that decides
 * where to land, so does the picker; the conversation is read by the view and
 * again by the thing that titles it. Each of those is most of a second
 * against the server, and they were all in flight within the same two
 * seconds of each other.
 *
 * So identical GETs share one request while it is open, and the answer is
 * kept for a moment afterwards for the ones that arrive just behind it. Three
 * seconds, because the two that survived a shorter window were the shell's -
 * it mounts after the route changes, which is a round trip later. Nothing can
 * go stale in it that this client caused, since a write empties the cache;
 * what is left is a change made somewhere else, which was never going to
 * arrive in this tab without a reload anyway. Anything that polls says
 * `fresh` and opts out.
 *
 * Only GETs, and only successful ones: a failure must be retryable
 * immediately, and a write must always reach the server.
 */
const CACHE_MS = 3000;
const inFlight = new Map<string, { at: number; promise: Promise<unknown> }>();

function cacheable(options: RequestOptions): boolean {
  const method = (options.method ?? "GET").toUpperCase();
  return method === "GET" && !options.fresh;
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
  _isRetry = false,
): Promise<T> {
  if (cacheable(options) && !_isRetry) {
    const hit = inFlight.get(path);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise as Promise<T>;
    const promise = request<T>(path, options, _isRetry);
    inFlight.set(path, { at: Date.now(), promise });
    // A failure is not an answer worth keeping - drop it so the next caller
    // asks again rather than inheriting the error.
    promise.catch(() => {
      if (inFlight.get(path)?.promise === promise) inFlight.delete(path);
    });
    return promise;
  }
  const result = request<T>(path, options, _isRetry);
  // A write may have changed anything: a new chat, a rename, a deleted
  // attachment. Rather than audit every read that follows a write, a write
  // empties the cache - a `fresh` GET does not, since it is only opting
  // itself out. The dedupe that matters, several components asking the same
  // question in the same moment, is unaffected either way.
  if ((options.method ?? "GET").toUpperCase() !== "GET") {
    void result.then(
      () => inFlight.clear(),
      () => inFlight.clear(),
    );
  }
  return result;
}

async function request<T>(
  path: string,
  options: RequestOptions,
  _isRetry: boolean,
): Promise<T> {
  // `fresh` is read by the cache above and is not a fetch option.
  const { body, headers, fresh, ...rest } = options;
  void fresh;
  const accessToken = getAccessToken();

  // reported to serverWait, which tells a cold start from a slow endpoint
  const res = await trackServerWait(fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }), (r) => r.status < 500);

  if (res.status === 401 && !_isRetry && getRefreshToken()) {
    const newAccessToken = await refreshAccessToken();
    if (newAccessToken) {
      return request<T>(path, options, true);
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
