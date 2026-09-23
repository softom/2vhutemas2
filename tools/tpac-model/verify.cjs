const {chromium}=require('C:/Users/tigra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs');const path=require('path');
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/tigra/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--enable-unsafe-swiftshader']});
try {
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8766/prototype-v02/viewer.html?software=1');
await page.waitForFunction(()=>document.querySelectorAll('#view svg path').length>100);
await page.screenshot({path:path.join(__dirname,'preview.png')});
const svg=await page.locator('#view svg').evaluate(el=>el.outerHTML);fs.writeFileSync(path.join(__dirname,'preview.svg'),svg);
const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await exportGLB())));fs.writeFileSync(path.join(__dirname,'tpac-study-v02.glb'),Buffer.from(bytes));
await page.locator('#scheme').check();await page.locator('#wire').check();await page.locator('#wire').uncheck();await page.locator('#top').click();await page.locator('#home').click();
await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(__dirname,'preview-mobile.png')});
console.log(JSON.stringify({errors,glbBytes:bytes.length,svgPaths:await page.locator('#view svg path').count(),mobileOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)}));
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});

