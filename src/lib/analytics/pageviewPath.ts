/** The path sent as a `$pageview`: /trace/<id> becomes /trace/:id (the id is a read capability). */
export function pageviewPath(pathname: string): string {
  return pathname.replace(/\/trace\/[^/]+\/?$/, "/trace/:id");
}
