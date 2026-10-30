import { apiErrorSchema } from '@dp/shared';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  get isNetwork() {
    return this.code === 'NETWORK';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Same-origin JSON client. Authentication rides on the HttpOnly session cookie,
 * so nothing auth-related is ever read or written by JavaScript.
 */
export async function api<T>(
  path: string,
  { method = 'GET', body, signal }: RequestOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      credentials: 'same-origin',
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiRequestError(0, 'NETWORK', 'No connection. Check your internet and try again.');
  }

  const data: unknown = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (res.ok) return data as T;

  const parsed = apiErrorSchema.safeParse(data);
  if (parsed.success) {
    const { code, message, fields } = parsed.data.error;
    throw new ApiRequestError(res.status, code, message, fields);
  }
  throw new ApiRequestError(res.status, 'UNEXPECTED', 'Something went wrong. Please try again.');
}
