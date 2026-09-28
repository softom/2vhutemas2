// Проверка единственной карточки: гость, SU, переходы и стандартный редактор.
const { chromium } = require('C:/Users/tigra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const origin = 'https://2vhutemas.ru';
const outputDir = 'backups/reader-check';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/tigra/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe' });
  fs.mkdirSync(outputDir, { recursive: true });
  const errors = [];
  const pending = new Set();
  const results = [];
  const watch = page => {
    page.setDefaultNavigationTimeout(60000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (req.resourceType() === 'script' && req.url().startsWith(origin)) pending.add(req.url()); });
    page.on('requestfinished', req => pending.delete(req.url()));
    page.on('requestfailed', req => { pending.delete(req.url()); console.log('Request failed:', new URL(req.url()).pathname, req.failure()?.errorText); });
  };
  try {
    if (!process.argv.includes('--signed-only')) {
    const guest = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await guest.newPage(); watch(page);
    for (const slug of ['muzey-terrakotovoy-armii', 'the-burnt-city-punchdrunk', 'taipei-performing-arts-center', 'about-philosophy']) {
      const scripts = [];
      const record = request => { if (request.resourceType() === 'script' && request.url().startsWith(origin)) scripts.push(request.url()); };
      page.on('request', record);
      const start = Date.now();
      const response = await page.goto(`${origin}/entities/${slug}`, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200, slug);
      await page.locator('.public-card').waitFor();
      await page.locator('.cite-disclosure').waitFor();
      assert.equal(await page.locator('.public-card').count(), 1);
      assert.equal(await page.getByRole('link', { name: 'Править запись', exact: true }).count(), 0);
      assert.equal(scripts.some(url => /appMount|EntityEditor|EntityPage|\/api-/.test(url)), false);
      assert.equal(await page.locator('.cite-disclosure').evaluate(el => el.open), false);
      results.push({ slug, readyMs: Date.now() - start, scripts });
      page.off('request', record);
      console.log(`Verified guest: ${slug}`);
    }
    await page.goto(`${origin}/entities/taipei-performing-arts-center`, { waitUntil: 'domcontentloaded' });
    await page.locator('dialog.reader-lightbox').waitFor({ state: 'attached' });
    await page.locator('[data-gallery]').first().click();
    assert.equal(await page.locator('dialog').evaluate(el => el.open), true);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Escape');
    await page.locator('.cite-disclosure > summary').click();
    await page.locator('[data-copy="cite-gost"]').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.locator('#cite-gost').innerText());
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${outputDir}/mobile.png` });
    const plain = await browser.newContext({ javaScriptEnabled: false });
    const noJS = await plain.newPage();
    await noJS.goto(`${origin}/entities/the-burnt-city-punchdrunk`, { waitUntil: 'domcontentloaded' });
    assert.equal(await noJS.locator('.public-card').count(), 1);
    assert.match(await noJS.locator('main').innerText(), /Показатели[\s\S]*Места[\s\S]*Датировки/);
    await plain.close();
    }
    // Краткоживущий токен существующего SU: тот же способ, что у smoke.sh.
    // Токен только в памяти теста; в отчёт, команды и файлы не попадает.
    const smoke = fs.readFileSync('tools/smoke.sh', 'utf8');
    const tokenScript = smoke.slice(smoke.indexOf('UID_T='), smoke.indexOf('AUTH="')).replace('docker exec -i ', 'docker exec ') + '\nprintf "%s" "$TOKEN"\n';
    const token = execFileSync('ssh', ['-o', 'BatchMode=yes', '2vhutemas', 'bash -s'], { input: tokenScript, encoding: 'utf8' }).trim();
    const supabaseUrl = execFileSync('ssh', ['-o', 'BatchMode=yes', '2vhutemas', "sed -n 's/^VITE_SUPABASE_URL=//p' /opt/2vhutemas-services/app-web/.env"], { encoding: 'utf8' }).trim();
    assert.equal(token.split('.').length, 3, 'Test token creation failed');
    const uid = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub;
    const session = { access_token: token, refresh_token: 'test-unused', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3500, expires_in: 3500, user: { id: uid, aud: 'authenticated', role: 'authenticated' } };
    const key = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
    const signed = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: key, value: JSON.stringify(session) }] }] } });
    const editorPage = await signed.newPage(); watch(editorPage);
    editorPage.on('response', async response => {
      if (response.url().includes('/api/v1/site-header')) {
        const me = (await response.json().catch(() => ({}))).viewer ?? {};
        console.log('Permission check:', JSON.stringify({ authenticated: me.authenticated, permissions: me.permissions }));
      }
    });
    const pencil = () => editorPage.getByRole('link', { name: 'Править запись', exact: true });
    for (const slug of ['muzey-terrakotovoy-armii', 'the-burnt-city-punchdrunk', 'about-logo', 'about-philosophy', 'about-manifest', 'about-feedback']) {
      await editorPage.goto(`${origin}/entities/${slug}`, { waitUntil: 'domcontentloaded' });
      await pencil().waitFor({ timeout: 45000 });
      assert.equal(await editorPage.locator('h1 .reader-edit-link svg').count(), 1);
      assert.equal(await pencil().innerText(), '');
      assert.equal(await editorPage.locator('[data-site-header]').count(), 1);
      assert.equal(await editorPage.locator('[data-site-header] a[href="/login"]').count(), 0);
      assert.equal(await editorPage.getByRole('button', { name: 'Выйти', exact: true }).count(), 1);
      const menu = await editorPage.locator('[data-site-header]').innerHTML();
      const html = await editorPage.locator('.public-card').innerHTML();
      if (slug === 'muzey-terrakotovoy-armii') await editorPage.screenshot({ path: `${outputDir}/card-pencil.png` });
      await pencil().click();
      await editorPage.locator('.bn-editor[contenteditable=true]').waitFor({ timeout: 45000 });
      assert.match(editorPage.url(), /\/entities\/\d+\/edit/);
      assert.equal(await editorPage.locator('[data-site-header]').innerHTML(), menu, `editor menu: ${slug}`);
      assert.equal(await editorPage.getByText('Страница не открылась', { exact: true }).count(), 0);
      await editorPage.getByRole('button', { name: 'К карточке', exact: true }).first().click();
      await pencil().waitFor();
      assert.equal(await editorPage.locator('.public-card').count(), 1);
      assert.equal(await editorPage.locator('.bn-editor').count(), 0);
      assert.equal(await editorPage.locator('.public-card').innerHTML(), html, `return: ${slug}`);
      assert.equal(await editorPage.locator('[data-site-header]').innerHTML(), menu, `returned menu: ${slug}`);
      await editorPage.reload({ waitUntil: 'domcontentloaded' });
      await pencil().waitFor();
      assert.equal(await editorPage.locator('.public-card').innerHTML(), html, `reload: ${slug}`);
      results.push({ slug, editReturnAndReloadIdentical: true });
      console.log(`Verified editor roundtrip: ${slug}`);
    }
    await editorPage.goto(`${origin}/objects`, { waitUntil: 'domcontentloaded' });
    await editorPage.locator('a.card').first().waitFor();
    await editorPage.locator('a.card').first().click();
    await pencil().waitFor();
    assert.equal(await editorPage.locator('.public-card').count(), 1);
    // Старый адрес редактора по slug тоже загружает существующую запись.
    await editorPage.goto(`${origin}/entities/about-philosophy/edit`, { waitUntil: 'domcontentloaded' });
    await editorPage.locator('.bn-editor[contenteditable=true]').waitFor({ timeout: 45000 });
    assert.deepEqual(errors, []);
    const output = { results, guestCheckedThisRun: !process.argv.includes('--signed-only'), catalogNavigation: true, slugEditor: true, errors };
    fs.writeFileSync(`${outputDir}/results.json`, JSON.stringify(output, null, 2));
    console.log(JSON.stringify(output, null, 2));
  } finally { console.log('Pending scripts:', [...pending]); console.log('Browser errors:', errors); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
