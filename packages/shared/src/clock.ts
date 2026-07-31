/**
 * Injectable clock.
 *
 * Context lifecycle transitions and audit records are timestamped. Tests assert
 * on those timestamps, so time is a dependency rather than an ambient global.
 */
export interface Clock {
  now(): Date;
  isoNow(): string;
}

export const systemClock: Clock = {
  now: () => new Date(),
  isoNow: () => new Date().toISOString(),
};

/** Deterministic clock for tests and seeded demo data. */
export function fixedClock(start: string, stepMs = 1000): Clock {
  let current = new Date(start).getTime();
  return {
    now(): Date {
      const value = new Date(current);
      current += stepMs;
      return value;
    },
    isoNow(): string {
      return this.now().toISOString();
    },
  };
}
