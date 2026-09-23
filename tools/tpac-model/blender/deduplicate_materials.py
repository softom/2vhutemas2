import bpy,json
from pathlib import Path
ROOT=Path(r'E:/Dropbox/Приложения/remotely-save/LearnANDThink/Зрелищные здания/img/taipei-performing-arts-center/model/blender-review-v03')
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'tpac-review-v03.blend'))
def val(v):
 try:return tuple(round(float(x),6) for x in v)
 except TypeError:
  return round(v,6) if isinstance(v,float) else str(v)
def signature(m):
 if not m.use_nodes:return ('plain',tuple(m.diffuse_color))
 nodes=list(m.node_tree.nodes);ids={n:i for i,n in enumerate(nodes)}
 return (tuple((n.bl_idname,tuple((s.name,val(s.default_value)) for s in n.inputs if hasattr(s,'default_value')),n.image.name if n.type=='TEX_IMAGE' and n.image else None) for n in nodes),tuple((ids[l.from_node],l.from_socket.name,ids[l.to_node],l.to_socket.name) for l in m.node_tree.links))
seen={};before=len(bpy.data.materials)
for o in bpy.context.scene.objects:
 if o.type!='MESH':continue
 for slot in o.material_slots:
  m=slot.material
  if not m:continue
  sig=signature(m)
  if sig not in seen:seen[sig]=m
  slot.material=seen[sig]
for m in list(bpy.data.materials):
 if m.users==0:bpy.data.materials.remove(m)
# Correct first review direction: globe must be on the left of the central cube.
from mathutils import Vector
cam=bpy.data.objects['01_globe_street'];cam.location=(-110,150,32);cam.rotation_euler=(Vector((0,4,25))-cam.location).to_track_quat('-Z','Y').to_euler()
bpy.context.scene.camera=cam
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'tpac-master-v03.blend'))
(ROOT/'optimization.json').write_text(json.dumps({'materials_before':before,'materials_after':len(bpy.data.materials),'geometry_changed':False,'method':'identical imported node graphs and input values only'},indent=2),encoding='utf-8')
for name in ['01_globe_street','02_blue_box','03_roof_site']:
 bpy.context.scene.camera=bpy.data.objects[name];bpy.context.scene.render.filepath=str(ROOT/'review'/f'{name}.png');bpy.ops.render.render(write_still=True)
print('MATERIALS',before,len(bpy.data.materials))
