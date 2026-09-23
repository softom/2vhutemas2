/* TPAC study model v0.1. Metres are approximate, not surveyed.
   Plan references: Architectural Record drawings 14–16; photographs: Chris Stowers / OMA.
   Local axes: globe -Z, grand theater +X, blue box -X. No geographic north asserted. */
'use strict';
const T=THREE;
const scene=new T.Scene();scene.background=new T.Color(0xe6e5df);
const model=new T.Group();model.name='TPAC_study_v01';scene.add(model);
model.userData={status:'Approximate reference-based reconstruction, not surveyed',units:'metres',sources:['https://www.archdaily.com/981894/taipei-performing-arts-center-oma','https://www.architecturalrecord.com/articles/15951-at-omas-taipei-performing-arts-center-building-as-public-performance']};
const mat=(color,roughness=.7,metalness=0)=>new T.MeshStandardMaterial({color,roughness,metalness});
const glass=mat(0x687f83,.3,.4),silver=mat(0xb8bec0,.5,.65),frame=mat(0x9caaab,.4,.6),dark=mat(0x384748),concrete=mat(0xb5b7ae),plaza=mat(0xd5d4c9),seam=mat(0x929d9f,.7,.3);
const halls=[],facade=[];
function mesh(geo,material,name,parent=model){let m=new T.Mesh(geo,material);m.name=name;m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function box(name,w,h,d,x,y,z,material,parent=model){let m=mesh(new T.BoxGeometry(w,h,d),material,name,parent);m.position.set(x,y,z);return m;}
function rod(name,a,b,r,material,parent=model){const av=new T.Vector3(...a),bv=new T.Vector3(...b);let m=mesh(new T.CylinderGeometry(r,r,av.distanceTo(bv),10),material,name,parent);m.position.copy(av).add(bv).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),bv.sub(av).normalize());return m;}
box('Raised plaza',116,.8,108,0,-.4,0,plaza);
box('Podium',51,1.2,49,0,.6,0,concrete);
box('Ground lobby',40,6.6,36,0,4.5,2,glass);
box('Central glass volume',44,43,44,0,28.5,0,glass);
box('Opaque service spine',10,47,12,15,25.5,17,dark);
// Horizontal floor bands and narrow vertical corrugation give the cube its measured facade rhythm.
for(let y=7;y<=50;y+=4.3){for(let z of [-22.15,22.15])facade.push(box('Facade horizontal band',44.4,.19,.28,0,y,z,frame));for(let x of [-22.15,22.15])facade.push(box('Facade horizontal band',.28,.19,44.4,x,y,0,frame));}
for(let q=-21.7;q<22;q+=.62){for(let z of [-22.15,22.15])facade.push(box('Corrugated glazing rib',.065,42.7,.14,q,28.5,z,frame));for(let x of [-22.15,22.15])facade.push(box('Corrugated glazing rib',.14,42.7,.065,x,28.5,q,frame));}
box('Roof parapet',44.4,.8,44.4,0,50.2,0,frame);
box('Roof surface',42,.15,42,0,50.65,0,dark);
box('Rooftop enclosure',15,2,10,8,51.5,9,glass);
// Globe: slightly compressed ellipsoid, embedded in cube instead of a detached ball.
const globe=mesh(new T.SphereGeometry(17,64,40),silver,'Globe Playhouse');globe.position.set(-2,30,-30);globe.scale.set(1,.97,.94);halls.push(globe);
// Panel seams on the spherical shell, deliberately light and sparse.
const sphereLines=new T.Group();sphereLines.name='Globe panel joints';model.add(sphereLines);
function line(points,name){let l=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:0x939fa1,transparent:true,opacity:.52}));l.name=name;sphereLines.add(l);}
for(let lat=-60;lat<=60;lat+=20){let a=lat*Math.PI/180,pts=[];for(let i=0;i<=128;i++){let p=i/128*Math.PI*2;pts.push(new T.Vector3(-2+17.025*Math.cos(a)*Math.cos(p),30+16.515*Math.sin(a),-30+16.005*Math.cos(a)*Math.sin(p)));}line(pts,'Globe horizontal panel seam');}
for(let j=0;j<16;j++){let p=j*Math.PI/8,pts=[];for(let i=0;i<=64;i++){let a=-Math.PI/2+i/64*Math.PI;pts.push(new T.Vector3(-2+17.025*Math.cos(a)*Math.cos(p),30+16.515*Math.sin(a),-30+16.005*Math.cos(a)*Math.sin(p)));}line(pts,'Globe meridian panel seam');}
rod('Globe inclined support L',[-13,0,-40],[-9,17,-34],.7,frame);rod('Globe inclined support R',[9,0,-40],[5,17,-34],.7,frame);
// Blue box on opposite side of grand theatre, aligned stage to stage.
const blue=box('Blue Box',29,15,28,-35.5,20,3,silver);halls.push(blue);
for(let x=-49;x<-22;x+=3)box('Blue Box cladding joint',.045,15.05,28.05,x,20,3,seam);
for(let z of [-7,13])rod('Blue Box support',[-45,0,z],[-43,12.5,z],.65,frame);
// Grand theatre wedge: roof remains almost horizontal, underside rises outwards.
const verts=[22,11,-14, 51,20,-11, 51,32,-11, 22,32,-14, 22,11,18, 51,20,15, 51,32,15, 22,32,18];
const inds=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,1,2,6,1,6,5,0,4,7,0,7,3];
const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(verts,3));geo.setIndex(inds);geo.computeVertexNormals();
const grand=mesh(geo,silver,'Grand Theater');halls.push(grand);
for(let x=23;x<=50;x+=2.8){let t=(x-22)/29,y=11+9*t,d=32-6*t;box('Grand Theater cladding seam',.045,32-y,d+.03,x,(32+y)/2,2,seam);}
for(let z of [-8,12])rod('Grand Theater inclined support',[42,0,z],[45,18,z],.75,frame);
// Visible lower level and access stairs; service ramp represented schematically.
for(let x of [-17,17])for(let z of [-16,16])rod('Podium column',[x,0,z],[x,7,z],.45,concrete);
for(let i=0;i<10;i++)box('Entrance step',15,.18*(i+1),1.0,-3,.09*(i+1),-25+i,concrete);
const ramp=box('Service ramp',8,.5,31,27,4,29,concrete);ramp.rotation.x=-.21;
for(let i=0;i<30;i++){let a=i/30*Math.PI*2;let x=32+Math.cos(a)*7,z=30+Math.sin(a)*7;box('Ramp curb',.4,.3,1.55,x,1.2+i*.09,z,frame).rotation.y=-a;}
const stage=new T.Mesh(new T.PlaneGeometry(2000,2000),mat(0xe6e5df));stage.rotation.x=-Math.PI/2;stage.position.y=-.83;stage.receiveShadow=true;scene.add(stage);
scene.add(new T.HemisphereLight(0xffffff,0x748077,1.2));const sun=new T.DirectionalLight(0xfff4de,2.3);sun.position.set(-60,110,-70);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-85,right:85,top:85,bottom:-85,near:1,far:250});sun.shadow.bias=-.0003;scene.add(sun);
const fill=new T.DirectionalLight(0xd2eaff,.5);fill.position.set(70,40,50);scene.add(fill);
const camera=new T.PerspectiveCamera(36,innerWidth/innerHeight,.1,3000);camera.position.set(135,90,-145);
let renderer;try{renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});}catch(e){document.getElementById('error').style.display='block';document.getElementById('error').textContent='Для просмотра нужен браузер с WebGL. '+e.message;throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.outputEncoding=T.sRGBEncoding;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;document.getElementById('view').appendChild(renderer.domElement);
const controls=new T.OrbitControls(camera,renderer.domElement);controls.target.set(0,21,0);controls.enableDamping=true;controls.minDistance=65;controls.maxDistance=360;controls.maxPolarAngle=Math.PI*.49;controls.autoRotateSpeed=.6;
function view(pos){camera.position.set(...pos);controls.target.set(0,21,0);controls.update();}
document.getElementById('home').onclick=()=>view([135,90,-145]);document.getElementById('front').onclick=()=>view([0,40,-180]);
document.getElementById('top').onclick=()=>view([0,205,.1]);document.getElementById('rotate').onchange=e=>controls.autoRotate=e.target.checked;
document.getElementById('scheme').onchange=e=>{const colors=[0xce765b,0x51869b,0xc6aa59];halls.forEach((m,i)=>{m.material=e.target.checked?mat(colors[i],.6,.2):silver;});};
document.getElementById('wire').onchange=e=>model.traverse(m=>{if(m.isMesh)m.material.wireframe=e.target.checked;});
function exportGLB(){return new Promise((resolve,reject)=>{try{const clean=model.clone(true);clean.traverse(m=>{if(m.isMesh){m.material=m.material.clone();m.material.wireframe=false;if(halls.some(h=>h.name===m.name))m.material=silver.clone();}});new T.GLTFExporter().parse(clean,resolve,{binary:true,onlyVisible:true});}catch(e){reject(e);}});}
window.exportGLB=exportGLB;window.tpac={model,renderer,scene,camera,controls};
document.getElementById('export').onclick=async()=>{try{const data=await exportGLB();let u=URL.createObjectURL(new Blob([data],{type:'model/gltf-binary'}));let a=document.createElement('a');a.href=u;a.download='tpac-study-v01.glb';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}catch(e){document.getElementById('status').textContent='Ошибка экспорта: '+e.message;}};
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
let count=0;model.traverse(m=>{if(m.isMesh)count++;});document.getElementById('status').textContent='Версия 0.1 · '+count+' элементов';
let software=null,softwareScene=null,lastFrame=0;
function useSoftware(){
 if(software)return;
 software=new T.SVGRenderer();software.setSize(innerWidth,innerHeight);software.setQuality('low');
 software.domElement.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
 softwareScene=scene.clone(true);softwareScene.add(new T.AmbientLight(0xffffff,.4));softwareScene.traverse(o=>{if(o.isDirectionalLight)o.intensity*=.22;});
 softwareScene.traverse(o=>{if(o.isMesh){o.material=new T.MeshLambertMaterial({color:o.material.color,side:T.FrontSide});}});
 document.getElementById('view').appendChild(software.domElement);
 document.getElementById('status').textContent='Версия 0.1 · совместимый режим без GPU';
 window.tpac.software=software;
}
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();useSoftware();});
if(renderer.getContext().isContextLost()||new URLSearchParams(location.search).has('software'))useSoftware();
addEventListener('resize',()=>{if(software)software.setSize(innerWidth,innerHeight);});
const oldScheme=document.getElementById('scheme').onchange;
document.getElementById('scheme').onchange=e=>{oldScheme(e);if(softwareScene)halls.forEach(h=>softwareScene.getObjectByName(h.name).material.color.copy(h.material.color));};
const oldWire=document.getElementById('wire').onchange;
document.getElementById('wire').onchange=e=>{oldWire(e);if(softwareScene)softwareScene.traverse(m=>{if(m.isMesh)m.material.wireframe=e.target.checked;});};
function animate(time){requestAnimationFrame(animate);controls.update();if(software){if(time-lastFrame>80){software.render(softwareScene,camera);lastFrame=time;}}else renderer.render(scene,camera);}animate(0);



