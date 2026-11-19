import { describe, expect, it } from 'vitest';
import * as ui from '../index.js';

describe('golem-spec/ui entry', () => {
  it('exports exactly the documented runtime API', () => {
    expect(Object.keys(ui).sort()).toEqual(['mountStudio']);
  });
  it('mountStudio is a function', () => {
    expect(typeof ui.mountStudio).toBe('function');
  });
});
