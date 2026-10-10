import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { blankDeck, newChart, newShape, newTable, newTextBox, plainText, allElements, uid, type Deck } from '../src/core/model';
import { importPptx } from '../src/core/pptx-import';
import { exportPptx } from '../src/core/pptx-export';
import { saveBncpres, loadBncpres } from '../src/core/bncpres';
import { applyTableStyle, tableStyleById } from '../src/core/tablestyles';

// Folder of real .pptx files to round-trip (set BNC_SAMPLES); the real-file tests are skipped when it does not exist.
const SAMPLES = process.env.BNC_SAMPLES ?? join(__dirname, 'samples');

async function checkWellFormed(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const bad: string[] = [];
  for (const name of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    const res = XMLValidator.validate(await zip.files[name].async('string'));
    if (res !== true) bad.push(`${name}: ${res.err.msg} (line ${res.err.line})`);
  }
  expect(bad).toEqual([]);
  return zip;
}

const summary = (deck: Deck) =>
  deck.pres.slides.map((s) => {
    const kinds: Record<string, number> = {};
    for (const e of allElements(s.elements)) kinds[e.type] = (kinds[e.type] ?? 0) + 1;
    const text = allElements(s.elements)
      .map((e) => (e.type === 'shape' ? plainText(e.text) : e.type === 'table' ? e.rows.map((r) => r.cells.map((c) => plainText(c.text)).join('|')).join('/') : ''))
      .filter(Boolean)
      .join('\n');
    return { kinds, text };
  });

describe('own deck round trip', () => {
  it('exports a valid package and re-imports the same content', async () => {
    const deck = blankDeck();
    const s = deck.pres.slides[0];
    s.elements.push(newShape('roundRect', 100, 100, 200, 100));
    const tb = newTextBox(120, 300, 300, 40, 'Hello world');
    tb.text!.paras[0].runs = [{ t: 'Hello ', b: true }, { t: 'world', i: true, color: '#ff0000', sz: 30 }];
    s.elements.push(tb);
    const table = newTable(3, 3, 100, 360, 480);
    table.rows[0].cells[0].text.paras = [{ runs: [{ t: 'Head' }] }];
    applyTableStyle(table, tableStyleById('medium2-accent1'));
    s.elements.push(table);
    s.elements.push(newChart('col', 500, 100, 400, 250));
    s.anims = [{ id: uid('a'), target: tb.id, cls: 'entr', effect: 'fade', trigger: 'click', dur: 0.5, delay: 0 }];
    s.transition = { type: 'push', dir: 'b', dur: 0.75 };
    s.notes = [{ runs: [{ t: 'Speaker notes here' }] }];
    deck.pres.slides.push({ ...deck.pres.slides[0], id: uid('s'), elements: [], section: 'Second part' });

    const bytes = await exportPptx(deck, 'pptx');
    await checkWellFormed(bytes);
    const back = await importPptx(bytes);
    expect(back.pres.slides.length).toBe(2);
    const a = summary(deck);
    const b = summary({ pres: back.pres, media: back.media });
    expect(b[0].kinds.table).toBe(1);
    expect(b[0].kinds.chart).toBe(1);
    expect(b[0].text).toContain('Hello world');
    expect(b[0].text).toContain('Head');
    expect(back.pres.slides[0].notes?.[0].runs[0].t).toBe('Speaker notes here');
    expect(back.pres.slides[0].transition?.type).toBe('push');
    expect(back.pres.slides[0].transition?.dir).toBe('b');
    expect(back.pres.slides[0].anims?.length).toBe(1);
    expect(back.pres.slides[1].section).toBe('Second part');
    void a;
  });

  it('survives the .bncpres format', async () => {
    const deck = blankDeck();
    deck.pres.slides[0].elements.push(newShape('ellipse', 10, 10, 50, 50));
    const bytes = await saveBncpres(deck);
    const back = await loadBncpres(bytes);
    expect(back.pres.slides[0].elements.length).toBe(deck.pres.slides[0].elements.length);
  });
});

describe.skipIf(!existsSync(SAMPLES))('real PowerPoint files', () => {
  const files = existsSync(SAMPLES) ? readdirSync(SAMPLES).filter((f) => /\.pptx$/i.test(f) && !/Building a PC|^Presentation\.pptx$/.test(f)).slice(0, 8) : [];
  for (const f of files) {
    it(`${f}: import, export, import again`, async () => {
      const data = new Uint8Array(readFileSync(join(SAMPLES, f)));
      const first = await importPptx(data);
      const deck: Deck = { pres: first.pres, media: first.media };
      const bytes = await exportPptx(deck, 'pptx');
      await checkWellFormed(bytes);
      const second = await importPptx(bytes);
      const a = summary(deck);
      const b = summary({ pres: second.pres, media: second.media });
      expect(b.length).toBe(a.length);
      b.forEach((s, i) => {
        expect(s.text, `slide ${i + 1} text`).toBe(a[i].text);
        expect(s.kinds.picture ?? 0, `slide ${i + 1} pictures`).toBe(a[i].kinds.picture ?? 0);
        expect(s.kinds.table ?? 0, `slide ${i + 1} tables`).toBe(a[i].kinds.table ?? 0);
      });
    }, 120000);
  }
});
