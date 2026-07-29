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
