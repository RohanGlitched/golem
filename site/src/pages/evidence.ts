import type { SiteData } from '../build/data';
import type { PageSpec } from '../build/layout';

export function evidencePage(_data: SiteData): PageSpec {
  return { id: 'evidence', path: '/evidence/', title: 'Evidence', description: 'Stub.', body: '<h1>Evidence</h1>' };
}

