/** Injectable time source so expiry, cooldown and rate-limit logic can be tested deterministically. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Test clock that only moves when told to. */
export class ManualClock implements Clock {
  private current: number;

  constructor(start: Date | string = '2026-11-01T08:00:00Z') {
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current += ms;
  }

  advanceSeconds(s: number): void {
    this.advance(s * 1000);
  }
}

export const addSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
