export class ServiceError extends Error {
  constructor(
    message: string,
    public status = 0,
    public service?: string,
  ) {
    super(message);
  }
}

let jsonpSeq = 0;

/** JSONP request: works for APIs (Deezer, iTunes) that don't send CORS headers. */
export function jsonp<T>(url: string, opts: { param?: string; timeoutMs?: number } = {}): Promise<T> {
  const param = opts.param ?? 'callback';
  return new Promise<T>((resolve, reject) => {
    const name = `__mixtape_jsonp_${Date.now().toString(36)}_${jsonpSeq++}`;
    const script = document.createElement('script');
    const w = window as unknown as Record<string, unknown>;
    const cleanup = () => {
      delete w[name];
      script.remove();
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new ServiceError('Request timed out'));
    }, opts.timeoutMs ?? 9000);
    w[name] = (data: T) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new ServiceError('Network error'));
    };
    script.src = `${url}${url.includes('?') ? '&' : '?'}${param}=${name}`;
    document.head.appendChild(script);
  });
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ServiceError('Network error — are you online?');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string | { message?: string } };
      if (typeof body.error === 'string') message = body.error;
      else if (body.error?.message) message = body.error.message;
    } catch {
      /* not JSON */
    }
    throw new ServiceError(message, res.status);
  }
  return (await res.json()) as T;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

export function newUid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
}
