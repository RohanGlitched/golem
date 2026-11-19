/** Error type for everything the sim module throws on purpose. Plain-language messages, SI units. */
export class SimError extends Error {
  /** True once the error carries a trial identity prefix. */
  trialIdentified = false;
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, opts);
    this.name = 'SimError';
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Builds `Trial failed (app <id>, requirement <id>, seed <n>): <cause message>`.
 * A SimError that already carries a trial identity is returned unchanged.
 */
export function wrapTrialError(
  e: unknown,
  app: { id: string },
  req: { id: string },
  spec: { seed: number },
): SimError {
  if (e instanceof SimError && e.trialIdentified) return e;
  const err = new SimError(
    `Trial failed (app ${app.id}, requirement ${req.id}, seed ${String(spec.seed)}): ${errorMessage(e)}`,
    { cause: e },
  );
  err.trialIdentified = true;
  return err;
}
