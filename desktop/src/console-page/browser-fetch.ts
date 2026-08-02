export type BrowserFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function invokeBrowserFetch(
  fetch: BrowserFetch,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return init === undefined
    ? Reflect.apply(fetch, globalThis, [input])
    : Reflect.apply(fetch, globalThis, [input, init]);
}

export function createBrowserFetchPort(fetch: BrowserFetch): BrowserFetch {
  return (input, init) => invokeBrowserFetch(fetch, input, init);
}

export function fetchFromBrowser(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return invokeBrowserFetch(globalThis.fetch, input, init);
}
