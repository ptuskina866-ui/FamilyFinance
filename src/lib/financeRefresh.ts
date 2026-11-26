/** Coalesce notifications by data group and keep at most one read per group in flight. */
export function createFinanceRefresh<Group extends string>(
  load: (group: Group, signal: AbortSignal) => Promise<void>,
  delay = 220,
) {
  const pending = new Set<Group>();
  const running = new Set<Group>();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    timer = undefined;
    for (const group of pending) {
      if (running.has(group)) continue;
      pending.delete(group);
      running.add(group);
      void load(group, controller.signal).finally(() => {
        running.delete(group);
        if (pending.has(group)) schedule();
      });
    }
  };

  const schedule = () => {
    if (controller.signal.aborted || timer !== undefined) return;
    timer = setTimeout(flush, delay);
  };

  return {
    request(groups: readonly Group[]) {
      if (controller.signal.aborted) return;
      groups.forEach(group => pending.add(group));
      schedule();
    },
    dispose() {
      clearTimeout(timer);
      pending.clear();
      controller.abort();
    },
  };
}
