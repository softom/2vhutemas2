'use strict';
const T=THREE, start=performance.now(), statusEl=document.getElementById('status');
const scene=new T.Scene();scene.background=new T.Color(0xe8e8e1);
const camera=new T.PerspectiveCamera(38,innerWidth/innerHeight,.1,2000);
let renderer,controls,model,fallback=false;
const originalMaterials=new Map();
window.tpac={scene,camera,loaded:false,fallback:false};
function showFallback(message){
 fallback=true;window.tpac.fallback=true;
 if(renderer)renderer.domElement.style.display='none';
 document.getElementById('poster').style.display='block';
 document.getElementById('notice').textContent=message;
 statusEl.textContent='Статический рендер · GLB доступен для скачивания';
 for(const id of ['rotate','scheme'])document.getElementById(id).disabled=true;
}
try{
 renderer=new T.WebGLRenderer({antialias:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);
 renderer.outputEncoding=T.sRGBEncoding;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
 document.getElementById('view').appendChild(renderer.domElement);
 controls=new T.OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.target.set(0,24,0);controls.minDistance=55;controls.maxDistance=450;controls.maxPolarAngle=Math.PI*.495;
 window.tpac.renderer=renderer;window.tpac.controls=controls;
 renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();showFallback('3D-контекст недоступен. Показан сохранённый рендер.');});
 if(renderer.getContext().isContextLost())showFallback('3D-контекст недоступен. Показан сохранённый рендер.');
}catch(e){showFallback('В этом браузере WebGL недоступен. Показан сохранённый рендер.');}
scene.add(new T.HemisphereLight(0xffffff,0x6d7c6c,1.1));
const sun=new T.DirectionalLight(0xfff5df,1.4);sun.position.set(80,120,60);scene.add(sun);
const fill=new T.DirectionalLight(0xe0efff,.6);fill.position.set(-80,70,-70);scene.add(fill);
function view(name){
 const views={home:[165,110,125],front:[-115,55,-150],top:[0,235,.1]};
 camera.position.set(...views[name]);camera.zoom=Math.min(1,camera.aspect/.95);camera.updateProjectionMatrix();if(controls){controls.target.set(0,20,0);controls.update();}
 document.querySelectorAll('nav button').forEach(b=>b.setAttribute('aria-pressed',String(b.id===name)));
 if(fallback)document.getElementById('poster').src='review/'+({home:'02_blue_box',front:'01_globe_street',top:'03_roof_site'}[name])+'.png';
}
view('home');
for(const name of ['home','front','top'])document.getElementById(name).onclick=()=>view(name);
document.getElementById('rotate').onchange=e=>{if(controls)controls.autoRotate=e.target.checked;};
document.getElementById('scheme').onchange=e=>{
 if(!model)return;
 model.traverse(o=>{if(!o.isMesh)return;const key=['Globe','Grand_Theater','Blue_Box'].find(k=>o.name.startsWith(k));
 if(!key)return;
 if(e.target.checked){if(!originalMaterials.has(o))originalMaterials.set(o,o.material);
 o.material=o.material.clone();o.material.color.setHex({Globe:0xba755d,Grand_Theater:0xb6a164,Blue_Box:0x597e9b}[key]);o.material.metalness=.15;}
 else if(originalMaterials.has(o)){o.material.dispose();o.material=originalMaterials.get(o);}
 });
};
new T.GLTFLoader().load('tpac-v05.glb',gltf=>{
 model=gltf.scene;scene.add(model);let meshes=0,triangles=0;model.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;}});
 window.tpac.model=model;window.tpac.loaded=true;window.tpac.metrics={meshes,triangles,loadMs:Math.round(performance.now()-start)};
 if(!fallback)statusEl.textContent='1,61 МБ · '+meshes+' объектов · '+triangles.toLocaleString('ru-RU')+' треугольников';
},undefined,error=>{window.tpac.error=String(error);showFallback('Не удалось загрузить GLB. Откройте комплект через локальный HTTP-сервер.');});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.zoom=Math.min(1,camera.aspect/.95);camera.updateProjectionMatrix();if(renderer)renderer.setSize(innerWidth,innerHeight);});
function frame(){requestAnimationFrame(frame);if(controls)controls.update();if(renderer&&!fallback)renderer.render(scene,camera);}
frame();
