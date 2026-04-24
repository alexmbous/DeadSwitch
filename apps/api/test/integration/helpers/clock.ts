/**
 * Controllable clock. Tests that need to simulate elapsed time call
 * clock.advance(ms); the app uses `now()` from here ONLY for intervals that
 * need to be testable (e.g., due dates for checkins).
 *
 * For the integration suite most of the time assertions are state-based
 * (we poke the service directly). The clock is here for the few tests that
 * need to observe timer-driven behavior.
 */
let offsetMs = 0;
export const clock = {
  now(): number { return Date.now() + offsetMs; },
  advance(ms: number): void { offsetMs += ms; },
  reset(): void { offsetMs = 0; },
};
