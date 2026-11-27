/** Cache Storage in memory, for tests: as much of it as the workers and pages use. Not published. */
export function memoryCaches(): CacheStorage {
  const stores = new Map<string, Map<string, Response>>();
  const url = (r: RequestInfo | URL): string =>
    typeof r === "string" ? r : r instanceof URL ? r.href : r.url;
  const bare = (u: string): string => u.replace(/[?#].*$/, "");
  return {
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        match: async (r: RequestInfo | URL, options?: CacheQueryOptions) => {
          const want = options?.ignoreSearch === true ? bare(url(r)) : url(r);
          for (const [key, response] of store) {
            if ((options?.ignoreSearch === true ? bare(key) : key) === want)
              return response.clone();
          }
          return undefined;
        },
        put: async (r: RequestInfo | URL, response: Response) => {
          store.set(url(r), response);
        },
        add: async (r: RequestInfo | URL) => {
          store.set(url(r), new Response("kept"));
        },
      } as unknown as Cache;
    },
  } as unknown as CacheStorage;
}
