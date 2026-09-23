/* TPAC study model v0.2. Metres are approximate, not surveyed.
   Plan references: Architectural Record drawings 14–16; photographs: Chris Stowers / OMA.
   Local axes: globe -Z, grand theater +X, blue box -X. No geographic north asserted. */
'use strict';
const T=THREE;
const scene=new T.Scene();scene.background=new T.Color(0xe6e5df);
const model=new T.Group();model.name='TPAC_study_v02';scene.add(model);
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
// Procedural material maps informed by collected photos; no photographic pixels reused.
function surfaceMap(kind){
 const c=document.createElement('canvas');c.width=512;c.height=512;const g=c.getContext('2d');
 let seed=731;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 if(kind==='glass'){
  g.fillStyle='#526e74';g.fillRect(0,0,512,512);
  for(let y=0;y<512;y+=64){for(let x=0;x<512;x+=16){let v=Math.round(65+random()*26+18*Math.sin(x*.3));g.fillStyle=`rgb(${v},${v+24},${v+30})`;g.fillRect(x,y,16,63);g.fillStyle='rgba(208,229,228,.35)';g.fillRect(x, y,2,63);}g.fillStyle='#b4c2bf';g.fillRect(0,y,512,2);}
 }else{
  g.fillStyle='#b5bab7';g.fillRect(0,0,512,512);
  for(let y=0;y<512;y+=128)for(let x=0;x<512;x+=64){let v=Math.round(163+random()*28);g.fillStyle=`rgb(${v},${v+5},${v+4})`;g.fillRect(x,y,63,127);}
  for(let i=0;i<12000;i++){let x=random()*512,y=random()*512;g.fillStyle=random()>.5?'rgba(255,255,255,.055)':'rgba(20,35,40,.045)';g.fillRect(x,y,1,4);}
 }
 const t=new T.CanvasTexture(c);t.encoding=T.sRGBEncoding;t.wrapS=t.wrapT=T.RepeatWrapping;t.name=kind+'-procedural-v02';return t;
}
const glassMap=surfaceMap('glass'),metalMap=surfaceMap('metal');glass.map=glassMap;glass.color.setHex(0xffffff);silver.map=metalMap;silver.color.setHex(0xffffff);silver.roughness=.62;
// Subdivision supports texture sampling in the compatible renderer.
model.getObjectByName('Central glass volume').geometry=new T.BoxGeometry(44,43,44,24,16,24);
blue.geometry=new T.BoxGeometry(29,15,28,12,6,12);
const flatGrand=grand.geometry.toNonIndexed();const uv=[];const pa=flatGrand.attributes.position;
for(let i=0;i<pa.count;i++)uv.push((pa.getX(i)+pa.getZ(i))/12,pa.getY(i)/12);
flatGrand.setAttribute('uv',new T.Float32BufferAttribute(uv,2));flatGrand.computeVertexNormals();grand.geometry=flatGrand;
model.children.filter(o=>o.name==='Grand Theater cladding seam'||o.name==='Blue Box cladding joint').forEach(o=>model.remove(o));
// Replace the generic rectangular base and initial schematic ramp with a site outline.
for(const name of ['Raised plaza','Service ramp']){const o=model.getObjectByName(name);if(o)model.remove(o);}
model.children.filter(o=>o.name==='Ramp curb').forEach(o=>model.remove(o));
const site=new T.Group();site.name='Site plan v02 approximate';model.add(site);
const stone=mat(0xc6c6b9),stripe=mat(0x777e78),soil=mat(0x717f52),leaf=mat(0x70835c),bark=mat(0x6b6656),road=mat(0x545b59),white=mat(0xe1dfce);
const boundary=[[-65,-65],[-38,-69],[65,-28],[57,57],[-50,57]];
function patch(name,points,y,material,parent=site){const shape=new T.Shape();points.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();const m=mesh(new T.ShapeGeometry(shape),material,name,parent);m.rotation.x=-Math.PI/2;m.position.y=y;return m;}
patch('Irregular site paving',boundary,-.03,stone);
// Parallel dark paving bands clipped to the polygon, following the ground-plan/photo rhythm.
function clip(poly,axis,value,greater){let out=[];for(let i=0;i<poly.length;i++){let a=poly[i],b=poly[(i+1)%poly.length],aa=greater?a[axis]>=value:a[axis]<=value,bb=greater?b[axis]>=value:b[axis]<=value;if(aa)out.push(a);if(aa!==bb){let t=(value-a[axis])/(b[axis]-a[axis]);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}}return out;}
for(let z=-68;z<57;z+=6){let p=clip(clip(boundary,1,z,true),1,z+2.1,false);if(p.length>2)patch('Dark paving strip',p,0,stripe);}
patch('Planted edge', [[-64,-62],[-53,-62],[-38,49],[-48,52]],.07,soil);
patch('Rear planting', [[-38,47],[14,47],[14,55],[-39,55]],.07,soil);
patch('East planted pocket',[[54,-22],[61,-24],[55,44],[48,44]],.07,soil);
function tree(x,z,r=2.4){rod('Tree trunk',[x,0,z],[x,4,z],.16,bark,site);const crown=mesh(new T.IcosahedronGeometry(r,1),leaf,'Tree crown',site);crown.position.set(x,5.1,z);crown.scale.set(1,1.2,1);}
for(let i=0;i<10;i++)tree(-58+i*1.25,-53+i*10,2.2+(i%3)*.25);
for(let x=-33;x<15;x+=9)tree(x,51,2.1);
for(let z=-15;z<44;z+=12)tree(55-z*.075,z,2.25);
// Approximate perimeter streets and curb alignment. Not a georeferenced survey.
function segmentBox(name,a,b,width,height,y,material){let dx=b[0]-a[0],dz=b[1]-a[1];const m=box(name,width,height,Math.hypot(dx,dz),(a[0]+b[0])/2,y,(a[1]+b[1])/2,material,site);m.rotation.y=Math.atan2(dx,dz);return m;}
segmentBox('Street along front',[-72,-79],[78,-20],12,.15,-.25,road);
segmentBox('Street along rear',[-59,66],[68,66],12,.15,-.25,road);
segmentBox('Street along east',[73,-20],[67,64],10,.15,-.25,road);
for(let i=0;i<boundary.length;i++)segmentBox('Site curb',boundary[i],boundary[(i+1)%boundary.length],.4,.18,.02,concrete);
for(let x=-47;x<53;x+=10)box('Road dash',4,.025,.17,x,-.15,66,white,site);
for(let z=53;z<76;z+=2.3)box('Crosswalk',4,.03,1.1,51,-.14,z,white,site);
// Circular descending drive shown on plan; simplified profile and radius.
const rampGroup=new T.Group();rampGroup.name='Circular service ramp approximate';model.add(rampGroup);
const path=[];for(let i=0;i<=64;i++){let a=i/64*Math.PI*1.75;path.push([35+Math.cos(a)*9,2.7-i/64*2.5,35+Math.sin(a)*9]);}
for(let i=0;i<path.length-1;i++){let a=path[i],b=path[i+1];let m=box('Ramp deck',5,.22,Math.hypot(b[0]-a[0],b[2]-a[2])+.1,(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2,road,rampGroup);m.rotation.y=Math.atan2(b[0]-a[0],b[2]-a[2]);for(let r of [6.5,11.5]){let q=i/64*Math.PI*1.75,q2=(i+1)/64*Math.PI*1.75;rod('Ramp guardrail',[35+Math.cos(q)*r,a[1]+.85,35+Math.sin(q)*r],[35+Math.cos(q2)*r,b[1]+.85,35+Math.sin(q2)*r],.10,frame,rampGroup);}}
// Long dark window, entry glazing, planted roof visible in elevated photos.
box('Blue Box ribbon window',.18,2.6,19,-50.1,19.5,3,dark);
for(let z=-5;z<=11;z+=2)box('Ribbon window mullion',.2,2.6,.08,-50.22,19.5,z,frame);
box('Entry glass doors',12,4,.15,-3,2.5,-22.3,glass);
for(let x=-8;x<=3;x+=2)box('Door frame',.09,4,.2,x,2.5,-22.45,frame);
box('Blue Box roof garden',24,.15,23,-35,27.6,3,soil);
for(let x=-43;x<-25;x+=5){const d=mesh(new T.CylinderGeometry(1.6,1.6,.1,20),plaza,'Roof circular stepping area');d.position.set(x,27.75,3+Math.sin(x)*4);}
for(let x=-29;x<=14;x+=11){box('Bench seat',3,.16,.65,x,.6,45,mat(0x8b7860),site);for(let dx of [-1,1])box('Bench leg',.12,.5,.5,x+dx,.3,45,dark,site);}
for(let x=-23;x<20;x+=8)rod('Entrance bollard',[x,0,-27],[x,.9,-27],.09,frame,site);
// Raster maps become triangle colours in SVG mode (SVGRenderer cannot display texture maps).
function softwareMaterial(meshObject){
 const original=meshObject.material;if(!original.map)return new T.MeshLambertMaterial({color:original.color,side:T.FrontSide});
 const canvas=original.map.image,ctx=canvas.getContext('2d'),pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 const g=meshObject.geometry.index?meshObject.geometry.toNonIndexed():meshObject.geometry.clone();const uvs=g.attributes.uv;
 if(!uvs)return new T.MeshLambertMaterial({color:original.color});
 const colors=[];for(let i=0;i<uvs.count;i+=3){let u=0,v=0;for(let j=0;j<3;j++){u+=uvs.getX(i+j)/3;v+=uvs.getY(i+j)/3;}u=((u%1)+1)%1;v=((v%1)+1)%1;u=(Math.floor(u*24)+.5)/24;v=(Math.floor(v*16)+.5)/16;let p=(Math.min(canvas.height-1,Math.floor((1-v)*canvas.height))*canvas.width+Math.floor(u*canvas.width))*4;for(let j=0;j<3;j++)colors.push(pixels[p]/255,pixels[p+1]/255,pixels[p+2]/255);}
 g.setAttribute('color',new T.Float32BufferAttribute(colors,3));meshObject.geometry=g;
 return new T.MeshLambertMaterial({color:0xffffff,vertexColors:true,side:T.FrontSide});
}

const stage=new T.Mesh(new T.PlaneGeometry(2000,2000),mat(0xe6e5df));stage.rotation.x=-Math.PI/2;stage.position.y=-.83;stage.receiveShadow=true;scene.add(stage);
scene.add(new T.HemisphereLight(0xffffff,0x748077,1.2));const sun=new T.DirectionalLight(0xfff4de,2.3);sun.position.set(-60,110,-70);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-85,right:85,top:85,bottom:-85,near:1,far:250});sun.shadow.bias=-.0003;scene.add(sun);
const fill=new T.DirectionalLight(0xd2eaff,.5);fill.position.set(70,40,50);scene.add(fill);
const camera=new T.PerspectiveCamera(36,innerWidth/innerHeight,.1,3000);camera.position.set(155,102,-165);
let renderer;try{renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});}catch(e){document.getElementById('error').style.display='block';document.getElementById('error').textContent='Для просмотра нужен браузер с WebGL. '+e.message;throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.outputEncoding=T.sRGBEncoding;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;document.getElementById('view').appendChild(renderer.domElement);
const controls=new T.OrbitControls(camera,renderer.domElement);controls.target.set(0,21,0);controls.enableDamping=true;controls.minDistance=65;controls.maxDistance=360;controls.maxPolarAngle=Math.PI*.49;controls.autoRotateSpeed=.6;
function view(pos){camera.position.set(...pos);controls.target.set(0,21,0);controls.update();}
document.getElementById('home').onclick=()=>view([155,102,-165]);document.getElementById('front').onclick=()=>view([0,40,-180]);
document.getElementById('top').onclick=()=>view([0,205,.1]);document.getElementById('rotate').onchange=e=>controls.autoRotate=e.target.checked;
document.getElementById('scheme').onchange=e=>{const colors=[0xce765b,0x51869b,0xc6aa59];halls.forEach((m,i)=>{m.material=e.target.checked?mat(colors[i],.6,.2):silver;});};
document.getElementById('wire').onchange=e=>model.traverse(m=>{if(m.isMesh)m.material.wireframe=e.target.checked;});
function exportGLB(){return new Promise((resolve,reject)=>{try{const clean=model.clone(true);clean.traverse(m=>{if(m.isMesh){m.material=m.material.clone();m.material.wireframe=false;if(halls.some(h=>h.name===m.name))m.material=silver.clone();}});new T.GLTFExporter().parse(clean,resolve,{binary:true,onlyVisible:true});}catch(e){reject(e);}});}
window.exportGLB=exportGLB;window.tpac={model,renderer,scene,camera,controls};
document.getElementById('export').onclick=async()=>{try{const data=await exportGLB();let u=URL.createObjectURL(new Blob([data],{type:'model/gltf-binary'}));let a=document.createElement('a');a.href=u;a.download='tpac-study-v02.glb';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}catch(e){document.getElementById('status').textContent='Ошибка экспорта: '+e.message;}};
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
let count=0;model.traverse(m=>{if(m.isMesh)count++;});document.getElementById('status').textContent='Версия 0.2 · '+count+' элементов';
let software=null,softwareScene=null,lastFrame=0;
function useSoftware(){
 if(software)return;
 software=new T.SVGRenderer();software.setSize(innerWidth,innerHeight);software.setQuality('low');
 software.domElement.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
 softwareScene=scene.clone(true);softwareScene.add(new T.AmbientLight(0xffffff,.4));softwareScene.traverse(o=>{if(o.isDirectionalLight)o.intensity*=.22;});
 softwareScene.traverse(o=>{if(o.isMesh){o.material=softwareMaterial(o);}});
 document.getElementById('view').appendChild(software.domElement);
 document.getElementById('status').textContent='Версия 0.2 · совместимый режим без GPU';
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





