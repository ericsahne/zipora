/** Thin wrapper so full-page navigations (OAuth redirects) can be observed in tests. */
export const nav = {
  redirect: (url: string): void => window.location.assign(url),
};
