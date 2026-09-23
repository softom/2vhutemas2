import bpy,json
from mathutils import Vector
bpy.ops.wm.open_mainfile(filepath=r'E:/Dropbox/Приложения/remotely-save/LearnANDThink/Зрелищные здания/img/taipei-performing-arts-center/model/blender-review-v03/tpac-master-v03-camera02.blend')
for o in bpy.context.scene.objects:
 if any(k in o.name for k in ['Central','Globe Play','Theater','Blue Box','Opaque','ramp','Ramp','Ground lobby']):
  print(o.name,tuple(round(v,2) for v in o.matrix_world.translation),tuple(round(v,2) for v in o.dimensions))
