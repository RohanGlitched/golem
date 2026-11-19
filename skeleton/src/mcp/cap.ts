// The Tool_Time_Cap: one abort signal that fires after `capS` seconds or when the parent aborts.
export async function withTimeCap<T>(
  capS: number, parent: AbortSignal, body: (signal: AbortSignal) => Promise<T>,
): Promise<{ value?: T; capped: boolean }> {
  const ctl = new AbortController();
  let capped = false;
  const timer = setTimeout(() => { capped = true; ctl.abort(); }, capS * 1000);
  try {
    const value = await body(AbortSignal.any([parent, ctl.signal]));
    return { value, capped };
  } catch (e) {
    if (capped && (e as { name?: string }).name === 'AbortError') return { capped: true };
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
