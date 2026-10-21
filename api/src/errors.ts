export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function errorProperty(error: unknown, key: string): unknown {
  return typeof error === "object" && error !== null && key in error
    ? (Reflect.get(error, key) as unknown)
    : undefined;
}
