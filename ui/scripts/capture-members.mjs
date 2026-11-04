// Local headless fixture. Every IAM request is intercepted; no portal connection is used.
import assert from 'node:assert/strict';
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const output = path.resolve(process.argv[2] || '.evidence/members');
await mkdir(output, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 4179, strictPort: true } });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: output } });
  await context.addInitScript(() => {
    const ctx = {
      token: 'fixture-token', kcpPath: 'root:orgs:fixture:account', openkcmPage: 'l1-key-managers', openkcmLevel: 'account',
      portalContext: { crdGatewayApiUrl: 'http://127.0.0.1:4179/gateway/graphql', iamServiceApiUrl: 'http://127.0.0.1:4179/iam/graphql' }
    };
    window.LuigiClient = {
      addInitListener(callback) { queueMicrotask(() => callback(ctx)); return 'fixture'; },
      addContextUpdateListener() { return 'fixture'; },
      removeInitListener() {}, removeContextUpdateListener() {}
    };
  });
  let holders = [{ userId: 'owner@example.test', email: 'owner@example.test' }];
  const candidate = { userId: 'alex@example.test', email: 'alex@example.test' };
  let mutations = 0;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    // UI5 loads its font assets from this CDN. No portal requests leave the fixture.
    if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@sap-theming/') && url.pathname.endsWith('.woff2')) {
      await route.continue();
      return;
    }
    assert.equal(url.origin, 'http://127.0.0.1:4179', 'External requests are forbidden in this fixture.');
    if (url.pathname === '/rest/permissions/resource-check') {
      const body = route.request().postDataJSON();
      await route.fulfill({ json: [{ resource: 'l1keyaccesses', name: 'account-l1', actions: body.checks[0].actions }] });
    } else if (url.pathname === '/iam/graphql') {
      const { query, variables } = route.request().postDataJSON();
      let data;
      if (query.includes('query L1Candidate')) {
        data = { user: variables.userId === candidate.email ? candidate : null };
      } else if (query.includes('mutation AddL1KeyManager')) {
        assert.deepEqual(variables, {
          context: { group: 'operations.openkcm.io', kind: 'L1KeyAccess', resource: { name: 'account-l1' }, accountPath: 'root:orgs:fixture:account' },
          changes: [{ userId: candidate.userId, roles: ['l1_key_manager'] }]
        });
        holders.push(candidate); mutations++;
        data = { assignRolesToUsers: { success: true, errors: null, assignedCount: 2 } };
      } else if (query.includes('mutation RevokeL1KeyManager')) {
        holders = holders.filter(user => user.userId !== variables.input.userId);
        data = { removeRole: { success: true, error: null, wasAssigned: true } };
      } else {
        assert.ok(query.includes('query L1KeyManagers'));
        data = { users: { users: holders.map(user => ({ user, roles: [{ id: 'l1_key_manager' }] })), pageInfo: { hasNextPage: false, totalCount: holders.length } } };
      }
      await route.fulfill({ json: { data } });
    } else {
      assert.ok(!url.pathname.startsWith('/gateway'), 'Key APIs must not load on Members.');
      await route.continue();
    }
  });
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('http://127.0.0.1:4179');
  await page.getByText('owner@example.test', { exact: true }).waitFor();
  const email = page.getByLabel('Email address');
  await email.fill(candidate.email);
  await page.getByRole('button', { name: 'Find user', exact: true }).click();
  await page.getByRole('button', { name: 'Assign L1 Key Manager', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'members-inline.png'), fullPage: true });
  await page.getByRole('button', { name: 'Assign L1 Key Manager', exact: true }).click();
  await page.locator('ui5-message-strip').filter({hasText:'The L1 Key Manager was added.'}).waitFor();
  await page.getByText(candidate.email, { exact: true }).waitFor();
  await email.fill(candidate.email);
  await page.getByRole('button', { name: 'Find user', exact: true }).click();
  await page.getByRole('button', { name: 'Assign L1 Key Manager', exact: true }).click();
  await page.locator('ui5-message-strip').filter({hasText:'This user is already an L1 Key Manager.'}).waitFor();
  assert.equal(mutations, 1, 'A duplicate must not cause another assignment.');
  await email.fill('new@example.test');
  await page.getByRole('button', { name: 'Find user', exact: true }).click();
  await page.locator('ui5-message-strip').filter({hasText:'This user is not in the organization. Add them on the org Members page first.'}).waitFor();
  await page.screenshot({ path: path.join(output, 'members-not-in-org.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The form must fit a narrow viewport.');
  await page.screenshot({ path: path.join(output, 'members-mobile.png'), fullPage: true });
  assert.deepEqual(failures, []);
  const video = page.video();
  await context.close();
  await rename(await video.path(), path.join(output, 'members-inline.webm'));
  console.log(JSON.stringify({ output, assignmentMutations: mutations, checks: ['lookup', 'add', 'holder refresh', 'duplicate', 'not in org', '390px layout'], errors: failures }));
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
