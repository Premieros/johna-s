// Retry only module loading; never replay a POS operation or reload its document.
export function isDynamicImportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|ChunkLoadError/i.test(message);
}

export async function retryModuleLoad<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (!isDynamicImportError(error)) throw error;
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    return load();
  }
}
