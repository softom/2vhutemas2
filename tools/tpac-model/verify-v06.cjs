const {chromium}=require('C:/Users/tigra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs');const path=require('path');
const root='E:/Dropbox/Приложения/remotely-save/LearnANDThink/Зрелищные здания/img/taipei-performing-arts-center/model/blender-v06';
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Users/tigra/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
try{const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8766/blender-v06/viewer.html');await page.waitForFunction(()=>window.tpac.loaded||window.tpac.error);
await page.waitForTimeout(500);
const metrics=await page.evaluate(()=>({...tpac.metrics,fallback:tpac.fallback,error:tpac.error,drawCalls:tpac.renderer?.info.render.calls,names:tpac.model?.children.map(x=>x.name)}));
await page.screenshot({path:path.join(root,'review/viewer-desktop.png')});
for(const id of ['front','top','core','ground','entry','home'])await page.locator('#'+id).click();
if(!metrics.fallback){await page.locator('#scheme').check();await page.locator('#scheme').uncheck();await page.locator('#rotate').check();await page.locator('#rotate').uncheck();}
await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'review/viewer-mobile.png')});
const mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
await page.goto('http://127.0.0.1:8766/blender-v06/review/index.html');
await page.waitForFunction(()=>Array.from(document.images).every(i=>i.complete));
const brokenImages=await page.evaluate(()=>Array.from(document.images).filter(i=>!i.naturalWidth).map(i=>i.src));
const result={metrics,errors,mobileOverflow,brokenImages};fs.writeFileSync(path.join(root,'browser-validation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
if(metrics.fallback||errors.length||mobileOverflow||brokenImages.length||metrics.error||metrics.meshes!==41||metrics.triangles!==43775)process.exitCode=1;
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
