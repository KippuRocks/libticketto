// Rules configuration — features/008-ledger-rules/plan.md §5.2, §5.4, §5.6.
//
// Set by whatever runs the rules, through `configureExecute`. Every limit is a
// whole number of milliseconds.

/** The default maximum operation lifetime: 24 hours (plan §5.4). */
export const DEFAULT_MAX_OPERATION_LIFETIME = 24 * 60 * 60 * 1000;

/** The default maximum recording lag: 5 minutes (plan §5.6). */
export const DEFAULT_MAX_RECORDING_LAG = 5 * 60 * 1000;

/** The default maximum clock skew: 10 seconds, the gate tolerance of F-025 (plan §5.2). */
export const DEFAULT_MAX_CLOCK_SKEW = 10 * 1000;

/**
 * The default maximum pass window: 5 minutes (plan §5.2, `REQ-AP-3`). An
 * organiser's per-event window is chosen within it.
 */
export const DEFAULT_MAX_PASS_WINDOW = 5 * 60 * 1000;

/** Configuration of the rules, set by whatever runs them. */
export interface RulesConfig {
  /**
   * How far ahead of the authority's clock a command's expiry may lie. Bounds
   * how long operation records are kept (plan §5.4, `AD-15`). Defaults to
   * {@link DEFAULT_MAX_OPERATION_LIFETIME}.
   */
  readonly maxOperationLifetime?: number;
  /**
   * How long after its `notAfter` an access pass may still be recorded, and so
   * how long a consumed pass id is kept (plan §5.6, `AD-13`). Defaults to
   * {@link DEFAULT_MAX_RECORDING_LAG}.
   */
  readonly maxRecordingLag?: number;
  /**
   * How far ahead of the authority's clock a pass's claimed `presentedAt` may
   * lie (plan §5.2). Defaults to {@link DEFAULT_MAX_CLOCK_SKEW}.
   */
  readonly maxClockSkew?: number;
  /**
   * The longest window, `notAfter − notBefore`, an access pass may carry, so
   * that every window is bounded (plan §5.2, `REQ-AP-3`, `NFR-5`). Defaults to
   * {@link DEFAULT_MAX_PASS_WINDOW}.
   */
  readonly maxPassWindow?: number;
}

/** Every limit, resolved. */
export type Limits = { readonly [K in keyof RulesConfig]-?: number };

/** The configuration with its defaults applied, each limit checked. */
export function resolveLimits(config: RulesConfig): Limits {
  const limits: Limits = {
    maxOperationLifetime: config.maxOperationLifetime ?? DEFAULT_MAX_OPERATION_LIFETIME,
    maxRecordingLag: config.maxRecordingLag ?? DEFAULT_MAX_RECORDING_LAG,
    maxClockSkew: config.maxClockSkew ?? DEFAULT_MAX_CLOCK_SKEW,
    maxPassWindow: config.maxPassWindow ?? DEFAULT_MAX_PASS_WINDOW,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} is a non-negative whole number of milliseconds`);
    }
  }
  return limits;
}
