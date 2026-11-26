type SaveAttempt = { key: string; id: string };

/** An unchanged draft keeps its operation ID even if its first response was lost. */
export function identifySaveAttempt(previous: SaveAttempt | null, draft: object): SaveAttempt {
  const key = JSON.stringify(draft);
  return previous?.key === key ? previous : { key, id: crypto.randomUUID() };
}
