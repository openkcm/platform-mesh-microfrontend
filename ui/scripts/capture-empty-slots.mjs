// Isolated headless browser against the actual App and local fixture responses.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const baseline = process.argv.find(arg => arg.startsWith('--before='))?.slice('--before='.length);
const before = Boolean(baseline);
const output = path.resolve('..', 'docs', 'evidence', 'empty-l1-slots');
await mkdir(output, { recursive: true });
const server = await createServer({
  plugins: baseline ? [{name:'baseline-app', enforce:'pre', load(id) {
    if (id.endsWith('/src/App.tsx')) return execFileSync('git', ['show', `${baseline}:ui/src/App.tsx`], {encoding:'utf8'});
  }}] : [],
  server:{host:'127.0.0.1', port:4183, strictPort:true}
});
await server.listen();
const browser = await chromium.launch({headless:true});
const results = [];
try {
  const context = await browser.newContext({viewport:{width:1280,height:2400}});
  // Only local Vite assets can leave this browser. The fixture replaces fetch.
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4183' ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const count of before ? [2] : [0,2,6]) {
    await page.goto(`http://127.0.0.1:4183/tests/fixtures/l1-slot-actions.html?configured=${count}`);
    await page.getByText(`${count} configured roots / 6 slots`, {exact:true}).waitFor();
    await page.evaluate(() => customElements.whenDefined('ui5-button'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (!before) {
      await page.locator('#check').click();
      assert.match(await page.locator('#result').innerText(), /^PASS:/);
      assert.equal(await page.locator('ui5-card[data-tier="L1"]').count(), count);
      assert.equal(await page.locator('.l1-empty-slot').count(), 6-count);
      if (count < 6) {
        for (const row of await page.locator('.l1-empty-slot').all()) {
          assert.ok((await row.boundingBox()).height <= 64, 'Empty rows must remain compact.');
        }
      } else assert.equal(await page.getByRole('region', {name:'Available providers'}).count(), 0);
    }
    await page.screenshot({path:path.join(output, `${before?'before':'after'}-${count}-configured.png`),fullPage:true});
    results.push({configured:count, cards:await page.locator('ui5-card[data-tier="L1"]').count(), rowHeights:await page.locator('.l1-empty-slot').evaluateAll(rows => rows.map(row=>row.getBoundingClientRect().height))});
  }
  if (!before) {
    await page.goto('http://127.0.0.1:4183/tests/fixtures/l1-slot-actions.html?configured=2');
    const configure = page.locator('.l1-empty-slot').filter({hasText:'OpenBao'}).getByRole('button', {name:'Configure Root Key'});
    await configure.waitFor();
    await configure.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', {name:'Configure Root Key: openbao'}).waitFor();
    await page.getByRole('button', {name:'Cancel',exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow.');
    await page.getByRole('region', {name:'Available providers'}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'after-mobile.png'),fullPage:true});
    await page.goto('http://127.0.0.1:4183/tests/fixtures/l1-slot-actions.html?configured=0&allowed=false');
    await page.getByText('0 configured roots / 6 slots', {exact:true}).waitFor();
    assert.equal(await page.locator('.l1-empty-slot ui5-button').count(),0, 'Denied users have no configure action.');
    await page.screenshot({path:path.join(output,'after-read-only.png'),fullPage:true});
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output,`${before?'before':'after'}-results.json`),JSON.stringify({results,errors},null,2)+'\n');
  console.log(JSON.stringify({output,results,errors}));
  await context.close();
} finally {
  await browser.close();
  await server.close();
}
