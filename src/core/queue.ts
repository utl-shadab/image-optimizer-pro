export async function runTaskQueue<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  worker: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      const currentItem = items[currentIndex];
      if (currentItem === undefined) {
        return;
      }

      results[currentIndex] = await worker(currentItem, currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
}
