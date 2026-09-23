import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(r'E:/Dropbox/Приложения/remotely-save/LearnANDThink/Зрелищные здания/img/taipei-performing-arts-center/model')
OUT=ROOT/'blender-v04';OUT.mkdir(exist_ok=True);(OUT/'review').mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'blender-review-v03/tpac-master-v03-camera02.blend'))
scene=bpy.context.scene
# Work in Blender world coordinates, preserving prior files and review cameras.
def material(name,color,metal=0,rough=.5):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;return m
metal=material('v04 aluminium',(.52,.56,.57),.55,.42)
dark=material('v04 technical cladding',(.045,.065,.08),.25,.5)
glass=material('v04 glazing',(.045,.10,.13),.45,.2)
concrete=material('v04 concrete',(.48,.5,.49),0,.8)
road=material('v04 asphalt',(.09,.105,.11),0,.9)
frame=material('v04 frames',(.3,.34,.35),.6,.4)
def cube(name,loc,size,mat):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat);return o
def rod(name,a,b,r,mat):
 a,b=Vector(a),Vector(b);bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=r,depth=(b-a).length,location=(a+b)/2);o=bpy.context.object;o.name=name;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=True
 return o
def remove_prefix(prefixes):
 for o in list(scene.objects):
  if any(o.name.startswith(p) for p in prefixes):bpy.data.objects.remove(o,do_unlink=True)
remove_prefix(['Opaque service spine','Rooftop enclosure','Ramp deck','Ramp guardrail','Circular service ramp','Grand Theater inclined support','Globe inclined support','Entrance step'])
# Rear stepped technical volumes inferred from photographs 06–07, dimensions approximate.
cube('Rear technical spine',(0,-25,24),(45,10,48),dark)
cube('Rear east tower',(18,-25,28),(12,12,56),dark)
cube('Rear west tower',(-17,-25,27),(12,12,54),dark)
for x in range(-21,23):cube('Rear cladding seam',(x,-30.08,24),(.045,.12,47.8),frame)
# Real opening, not a dark sticker on the projecting volume.
hall=bpy.data.objects['Grand Theater'];world=hall.matrix_world.copy();hall.parent=None;hall.matrix_world=world
bpy.ops.object.select_all(action='DESELECT');hall.select_set(True);bpy.context.view_layer.objects.active=hall;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
for p in hall.data.polygons:p.use_smooth=False
hall.data.materials.clear();hall.data.materials.append(metal)
cutter=cube('Temporary opening cutter',(51,-2,24),(3,21,3),glass)
bpy.context.view_layer.objects.active=hall;mod=hall.modifiers.new('Ribbon opening','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
cube('Recessed ribbon glazing',(49.7,-2,24),(.12,20.8,2.85),glass)
for y in range(-12,9,2):cube('Ribbon mullion',(49.85,y,24),(.15,.07,2.85),frame)
for y in [-10,10]:
 rod('Hall inclined support A',(41,y,0),(46,y,18.4),.55,frame)
 rod('Hall inclined support B',(49,y,0),(46,y,18.4),.55,frame)
globe=bpy.data.objects['Globe Playhouse']
for p in globe.data.polygons:p.use_smooth=True
globe.data.materials.clear();globe.data.materials.append(metal)
for x in [-9,5]:rod('Globe revised support',(x+(-3 if x<0 else 3),40,0),(x,34,17),.6,frame)
for i in range(10):cube('Entry step',(-3,27-i*.55,(i+1)*.075),(15,.55,(i+1)*.15),concrete)
cube('Entrance canopy',(-3,23,5.3),(15,5,.22),frame)
for x in [-10,4]:rod('Canopy support',(x,25,0),(x,25,5.2),.12,frame)
# Continuous helix deck, replacing disconnected blocks; ramp grade still schematic.
verts=[];faces=[];n=128
for i in range(n+1):
 a=i/n*math.tau;z=.12+5.8*i/n
 for r,dz in [(7.4,0),(12.6,0),(7.4,-.3),(12.6,-.3)]:verts.append((35+r*math.cos(a),-35+r*math.sin(a),z+dz))
for i in range(n):
 a=4*i;b=a+4;faces.extend([(a,a+1,b+1,b),(a+2,b+2,b+3,a+3),(a,b,b+2,a+2),(a+1,a+3,b+3,b+1)])
faces.extend([(0,2,3,1),(4*n,4*n+1,4*n+3,4*n+2)])
me=bpy.data.meshes.new('Continuous ramp');me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new('Continuous service ramp',me);scene.collection.objects.link(o);o.data.materials.append(road)
for r in [7.4,12.6]:
 cu=bpy.data.curves.new('Ramp parapet','CURVE');cu.dimensions='3D';cu.bevel_depth=.14;cu.bevel_resolution=2;sp=cu.splines.new('POLY');sp.points.add(n)
 for i,p in enumerate(sp.points):a=i/n*math.tau;p.co=(35+r*math.cos(a),-35+r*math.sin(a),1.05+5.8*i/n,1)
 ob=bpy.data.objects.new('Continuous ramp rail',cu);scene.collection.objects.link(ob);ob.data.materials.append(concrete)
a=Vector((45,-35,5.92));b=Vector((21,-28,5.92));bridge=cube('Loading bridge',(a+b)/2,(5.2,(b-a).length,.3),concrete);bridge.rotation_euler[2]=math.atan2(-(b-a).x,(b-a).y)
cube('Loading apron',(9,-29,5.92),(28,5,.3),concrete)
scene['revision']='v04: photographic study, dimensions approximate'
scene['limitations']='Rear blocks, opening, supports and ramp inferred from photos. Cameras not calibrated.'
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.camera=bpy.data.objects['02_blue_box'];bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'tpac-master-v04.blend'))
for name in ['01_globe_street','02_blue_box','03_roof_site']:
 scene.camera=bpy.data.objects[name];scene.render.filepath=str(OUT/'review'/f'{name}.png');bpy.ops.render.render(write_still=True)
bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:
 if o.type in {'MESH','CURVE'}:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'tpac-v04.glb'),export_format='GLB',use_selection=True,export_apply=True,export_cameras=False,export_lights=False)
report={'blender':bpy.app.version_string,'meshes':sum(o.type=='MESH' for o in scene.objects),'materials':len({s.material for o in scene.objects if o.type=='MESH' for s in o.material_slots if s.material}),'bytes':(OUT/'tpac-v04.glb').stat().st_size,'calibrated':False}
(OUT/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print('V04_COMPLETE',report)

