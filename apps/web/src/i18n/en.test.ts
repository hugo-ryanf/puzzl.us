import { describe, expect, it } from 'vitest';
import { CATALOG } from '@puzzle/shared';
import { en } from './en';

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('traduções em inglês', () => {
  it('mantêm os mesmos {valores} do texto em português', () => {
    const wrong = Object.entries(en).filter(
      ([pt, english]) =>
        [...new Set(placeholders(pt))].join() !== [...new Set(placeholders(english))].join(),
    );
    expect(wrong).toEqual([]);
  });

  it('cobrem o título de toda foto do catálogo', () => {
    const missing = CATALOG.filter((image) => !(image.title in en)).map((image) => image.title);
    expect(missing).toEqual([]);
  });
});
