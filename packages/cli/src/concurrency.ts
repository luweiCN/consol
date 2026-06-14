/**
 * Runs `mapper` over `values` with at most `concurrency` promises in flight at
 * once, preserving input order in the result. Used to bound subprocess fan-out
 * (e.g. `cast` calls) so large work sets do not spawn unbounded processes.
 */
export async function mapLimit<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) {
        results[index] = await mapper(value, index);
      }
    }
  };
  await Promise.all([...Array(Math.min(concurrency, values.length)).keys()].map(worker));
  return results;
}
