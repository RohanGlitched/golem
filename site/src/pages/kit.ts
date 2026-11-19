import type { SiteData } from '../build/data';
import type { PageSpec } from '../build/layout';

export function kitPage(_data: SiteData): PageSpec {
  return { id: 'kit', path: '/kit/', title: 'Kit', description: 'Stub.', body: '<h1>Kit</h1>' };
}

