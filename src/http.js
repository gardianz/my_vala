const DEFAULT_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Origin: 'https://vala-wallet.cc',
  Referer: 'https://vala-wallet.cc/dashboard',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
};

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  set(name, value) {
    if (!name) return;
    this.cookies.set(String(name), String(value));
  }

  setFromHeader(setCookie) {
    if (!setCookie) return;
    const [pair] = setCookie.split(';');
    this.setFromPair(pair);
  }

  setFromPair(pair) {
    if (!pair) return;
    const separator = pair.indexOf('=');
    if (separator <= 0) return;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!name) return;
    this.cookies.set(name, value);
  }

  setFromCookieHeader(cookieHeader) {
    if (!cookieHeader || typeof cookieHeader !== 'string') return;
    for (const pair of cookieHeader.split(';')) {
      this.setFromPair(pair);
    }
  }

  updateFromResponse(response) {
    const headerValues =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : response.headers.get('set-cookie')
          ? [response.headers.get('set-cookie')]
          : [];
    for (const headerValue of headerValues) {
      this.setFromHeader(headerValue);
    }
  }

  toHeader() {
    if (!this.cookies.size) return '';
    return Array.from(this.cookies.entries(), ([name, value]) => `${name}=${value}`).join('; ');
  }
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function parseJsonSafe(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export class HttpClient {
  constructor({ baseUrl, timeoutMs }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.jar = new CookieJar();
  }

  setCookie(name, value) {
    this.jar.set(name, value);
  }

  setCookieHeader(cookieHeader) {
    this.jar.setFromCookieHeader(cookieHeader);
  }

  async request(path, { method = 'GET', headers = {}, body } = {}) {
    const timeout = withTimeout(this.timeoutMs);
    try {
      const requestHeaders = {
        ...DEFAULT_HEADERS,
        ...headers,
      };
      const cookieHeader = this.jar.toHeader();
      if (cookieHeader) requestHeaders.Cookie = cookieHeader;
      if (body == null) delete requestHeaders['Content-Type'];

      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: requestHeaders,
        body: body == null ? undefined : JSON.stringify(body),
        redirect: 'follow',
        signal: timeout.signal,
      });

      this.jar.updateFromResponse(response);
      const payload = await parseJsonSafe(response);

      if (!response.ok) {
        const detail =
          payload?.error?.message ||
          payload?.message ||
          payload?.error ||
          `HTTP ${response.status}`;
        const error = new Error(detail);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }

      return payload;
    } finally {
      timeout.clear();
    }
  }
}
