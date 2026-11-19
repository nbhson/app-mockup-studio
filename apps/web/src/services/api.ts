// Thin typed wrapper around the backend API (NestJS at /api).
// SSE streaming for AI generation is also orchestrated here.

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      // Merge, don't clobber: a caller passing custom headers (e.g.
      // x-share-password) used to drop the default JSON content-type.
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    // No response at all: the API is down/restarting or the network dropped.
    // `TypeError: Failed to fetch` is useless in the UI, and every store
    // forwards `e.message`, so translate it here, once.
    throw new ApiError(
      0,
      "Không kết nối được server API. Kiểm tra API đang chạy (pnpm dev:api) rồi thử lại.",
    );
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      message = body.message ?? message;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
