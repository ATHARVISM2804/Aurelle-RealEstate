import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { priceFrom, formatPriceM, buildUnits } from '../api/_lib/inventory.mjs';

const read = (f) => readFile(new URL('../' + f, import.meta.url), 'utf8');

async function site() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(await read('js/config.js'), ctx);
  vm.runInContext(await read('js/plates.js'), ctx);
  return ctx.window;
}

/* Pull the explorer's own unitPrice() out of js/explorer.js so the test breaks if either side changes. */
async function explorerUnitPrice(INV) {
  const src = await read('js/explorer.js');
  const fn = src.match(/function unitPrice\(n, u\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, 'unitPrice() not found in js/explorer.js');
  return vm.runInNewContext(`(${fn[0]})`, { INV });
}

test('priceFrom + formatPriceM match the explorer label for all 76 units', async () => {
  const w = await site();
  const unitPrice = await explorerUnitPrice(w.INVENTORY);
  const units = buildUnits({ inventory: w.INVENTORY, plates: w.FLOOR_PLATES, unitPlans: w.UNIT_PLANS });
  assert.equal(units.length, 76);
  for (const u of units) {
    const plateUnit = { plan: u.plan, id: u.code.split('-')[1] };
    assert.equal(formatPriceM(priceFrom(u.plan, u.level, w.INVENTORY), w.INVENTORY.currency), unitPrice(u.level, plateUnit), u.code);
  }
});

test('statuses come from INVENTORY sold/reserved lists', async () => {
  const w = await site();
  const units = buildUnits({ inventory: w.INVENTORY, plates: w.FLOOR_PLATES, unitPlans: w.UNIT_PLANS });
  const by = Object.fromEntries(units.map((u) => [u.code, u]));
  for (const c of w.INVENTORY.sold) assert.equal(by[c].status, 'sold', c);
  for (const c of w.INVENTORY.reserved) assert.equal(by[c].status, 'reserved', c);
  assert.equal(by['01-A'].status, 'available');
  assert.equal(by['15-P1'].plan, 'fourBhk');
  assert.equal(by['16-P2'].plan, 'twoBhk');
  assert.deepEqual(by['01-C'].areas, { apartment: 588.6, balcony: 84.1, total: 672.7 });
});

test('unknown plan has no price', () => {
  assert.equal(priceFrom('nope', 3, { from: {}, perLevel: 0.01 }), null);
});
