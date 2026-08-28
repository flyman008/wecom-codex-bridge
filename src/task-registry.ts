export type BeginResult = 'started' | 'duplicate' | 'busy';

export class TaskRegistry {
  private readonly seen = new Map<string, number>();
  private readonly activeByActor = new Map<string, number>();

  constructor(
    private readonly maxActivePerActor: number,
    private readonly dedupeTtlMs = 10 * 60_000,
  ) {}

  begin(messageKey: string, actorKey: string, now = Date.now()): BeginResult {
    this.cleanup(now);
    if (this.seen.has(messageKey)) return 'duplicate';

    this.seen.set(messageKey, now);
    const active = this.activeByActor.get(actorKey) ?? 0;
    if (active >= this.maxActivePerActor) return 'busy';
    this.activeByActor.set(actorKey, active + 1);
    return 'started';
  }

  finish(actorKey: string): void {
    const active = this.activeByActor.get(actorKey) ?? 0;
    if (active <= 1) this.activeByActor.delete(actorKey);
    else this.activeByActor.set(actorKey, active - 1);
  }

  get activeTasks(): number {
    let count = 0;
    for (const active of this.activeByActor.values()) count += active;
    return count;
  }

  private cleanup(now: number): void {
    for (const [key, timestamp] of this.seen) {
      if (now - timestamp > this.dedupeTtlMs) this.seen.delete(key);
    }
  }
}
