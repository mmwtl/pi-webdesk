export function createServerFetch(allowedBaseUrl: string, providerId: string): typeof fetch {
  const allowed = new URL(allowedBaseUrl);
  return (async (input, init) => {
    const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const allowedPath = allowed.pathname.replace(/\/+$/, "");
    const pathAllowed = allowedPath === "" || target.pathname === allowedPath || target.pathname.startsWith(`${allowedPath}/`);
    if (target.origin !== allowed.origin || !pathAllowed) throw new TypeError("Request blocked: URL is outside the application API");
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.delete("user-agent");
    headers.delete("host");
    headers.delete("authorization");
    headers.set("x-pi-webdesk-provider", providerId);
    try {
      return await fetch(target, { ...init, headers });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      const detail = error instanceof Error ? `: ${error.message}` : "";
      throw new TypeError(`Could not reach the application API${detail} Run through Vercel, or use vercel dev locally.`);
    }
  }) as typeof fetch;
}
