import type { SiteData } from '../build/data';
import type { PageSpec } from '../build/layout';

export function howKiroPage(_data: SiteData): PageSpec {
  return { id: 'how-kiro', path: '/how-kiro/', title: 'How Kiro built it', description: 'Stub.', body: '<h1>How Kiro built it</h1>' };
}

