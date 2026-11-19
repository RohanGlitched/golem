// Severity of a scenario: how harsh it is within the searched ranges, 0 mildest to 1 harshest.
export interface SeverityDim { name: string; min: number; max: number; severity: 'up' | 'down' | 'none' }

/** Mean position in range over the dimensions that have a direction and a non-empty range; 0 when there are none. */
export function severity(dims: readonly SeverityDim[], scenario: Readonly<Record<string, number>>): number {
  const used = dims.filter((d) => d.severity !== 'none' && d.max > d.min);
  if (used.length === 0) return 0;
  let sum = 0;
  for (const d of used) {
    const v = scenario[d.name] ?? (d.severity === 'up' ? d.min : d.max);
    const pos = d.severity === 'up' ? (v - d.min) / (d.max - d.min) : (d.max - v) / (d.max - d.min);
    sum += Math.min(1, Math.max(0, pos));
  }
  return sum / used.length;
}