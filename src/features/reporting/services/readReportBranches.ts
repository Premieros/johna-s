/** Release database capacity between branch reports; never publish partial data. */
export async function readReportBranches<B, T>(branches: readonly B[], read: (branch: B) => Promise<T>, signal?: AbortSignal): Promise<T[]> {
  const results: T[] = [];
  for (const branch of branches) {
    signal?.throwIfAborted();
    results.push(await read(branch));
    signal?.throwIfAborted();
  }
  return results;
}
