/**
 * Platform envelope type for all API responses.
 * The raw wire format returned by every CARO backend route.
 */
export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

/** Internal error shape thrown by request() on a non-ok response. */
interface ApiError extends Error {
  code: string;
  details?: unknown;
}

/**
 * API client - handles HTTP requests with response unwrapping
 */

const API_BASE = '/api/v1';

/**
 * Make a fetch request and unwrap the response envelope.
 * Throws an ApiError (with .code and .details) if the server returns ok: false.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  const json = (await response.json()) as ApiResponse<T>;

  if (!json.ok) {
    const error = new Error(json.error.message || 'An error occurred') as ApiError;
    error.code = json.error.code;
    error.details = json.error.details;
    throw error;
  }

  return json.data;
}

export const apiClient = {
  get:    <T>(path: string): Promise<T> =>
    request<T>(path, { method: 'GET', cache: 'no-store' }),
  post:   <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'DELETE', body: JSON.stringify(body) }),
};
