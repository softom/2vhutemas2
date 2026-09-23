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
 const colors=[];for(let i=0;i<uvs.count;i+=3){let u=0,v=0;for(let j=0;j<3;j++){u+=uvs.getX(i+j)/3;v+=uvs.getY(i+j)/3;}u=((u%1)+1)%1;v=((v%1)+1)%1;let p=(Math.min(canvas.height-1,Math.floor((1-v)*canvas.height))*canvas.width+Math.floor(u*canvas.width))*4;for(let j=0;j<3;j++)colors.push(pixels[p]/255,pixels[p+1]/255,pixels[p+2]/255);}
 g.setAttribute('color',new T.Float32BufferAttribute(colors,3));meshObject.geometry=g;
 return new T.MeshLambertMaterial({color:0xffffff,vertexColors:true,side:T.FrontSide});
}
