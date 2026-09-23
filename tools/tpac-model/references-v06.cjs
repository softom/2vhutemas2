const {chromium}=require('C:/Users/tigra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs');
(async()=>{const b=await chromium.launch({headless:true,executablePath:'C:/Users/tigra/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});try{const p=await b.newPage({viewport:{width:1100,height:800}});
const urls=[
['oma-external-core','https://cdn.sanity.io/images/5azy6oei/production/e3fa600728867a7006a754ebae3bd5f8a65fb0e6-5477x3651.jpg?auto=format&fit=crop&q=80&w=1200'],
['stairs-detail','https://sphere-art.com/img/202211/CjabZksA.jpg'],
['entry-lobby','https://oss.gooood.cn/uploads/2022/05/027-taipei-performing-arts-center-oma-960x640.jpg']];
for(const [name,url] of urls){await p.goto(url,{timeout:60000});await p.screenshot({path:'E:/Dropbox/Приложения/remotely-save/LearnANDThink/Зрелищные здания/img/taipei-performing-arts-center/model/references-v06/'+name+'-browser-capture.png'});console.log(name,await p.title());}
}finally{await b.close();}})();
