// Page registry: id -> a function that renders the page from the committed data.
import type { SiteData } from '../build/data';
import type { PageSpec } from '../build/layout';
import { homePage } from './home';
import { kitPage } from './kit';
import { evidencePage } from './evidence';
import { howKiroPage } from './how-kiro';
import { notFoundPage } from './not-found';
import { studioPage } from './studio';
import { yardPage, yardStudioPage } from './yard';

export function renderPage(id: string, data: SiteData): PageSpec {
  switch (id) {
    case 'home': return homePage(data);
    case 'kit': return kitPage(data);
    case 'evidence': return evidencePage(data);
    case 'how-kiro': return howKiroPage(data);
    case 'yard': return yardPage();
    case 'notfound': return notFoundPage();
    case 'stagger': return studioPage('stagger');
    case 'candy': return studioPage('candy');
    case 'hover': return studioPage('hover');
    default:
      if (id.startsWith('yard-')) return yardStudioPage(id.slice(5));
      throw new Error(`No page is registered under "${id}"`);
  }
}
