// The committed pinned seeds of an app, served by seedsPlugin (src/build/pages-plugin.ts).
declare module 'virtual:golem-seeds/yard' {
  const seeds: Record<string, NonNullable<import('golem-spec/ui').StudioOptions['shippedSeeds']>>;
  export default seeds;
}
declare module 'virtual:golem-seeds/*' {
  const seeds: NonNullable<import('golem-spec/ui').StudioOptions['shippedSeeds']>;
  export default seeds;
}
