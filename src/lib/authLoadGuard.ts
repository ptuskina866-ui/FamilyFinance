export interface AuthLoadTicket {
  readonly version: number;
  readonly userId: string | null;
}

/** Invalidates outstanding profile/session reads when identity or lifecycle changes. */
export function createAuthLoadGuard() {
  let version = 0;
  let userId: string | null = null;
  let active = true;
  return {
    get userId() { return userId; },
    snapshot: (): AuthLoadTicket => ({ version, userId }),
    begin(nextUserId: string | null): AuthLoadTicket {
      userId = nextUserId;
      version += 1;
      return { version, userId };
    },
    isCurrent(ticket: AuthLoadTicket): boolean {
      return active && ticket.version === version && ticket.userId === userId;
    },
    activate() { active = true; version += 1; },
    invalidate() { active = false; version += 1; },
  };
}
