import { apiErrorSchema } from '@dp/shared';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }

  /** Numeric detail from the server, e.g. retryAfterSec or attemptsRemaining. */
  detailNumber(key: string): number | undefined {
    const v = this.details?.[key];
    return typeof v === 'number' ? v : undefined;
  }

  get isNetwork() {
    return this.code === 'NETWORK';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Same-origin JSON client. Authentication rides on the HttpOnly session cookie,
 * so nothing auth-related is ever read or written by JavaScript.
 */
export async function api<T>(
  path: string,
  { method = 'GET', body, signal, headers: extra }: RequestOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extra,
      },
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
    const { code, message, fields, details } = parsed.data.error;
    throw new ApiRequestError(res.status, code, message, fields, details);
  }
  throw new ApiRequestError(res.status, 'UNEXPECTED', 'Something went wrong. Please try again.');
}
