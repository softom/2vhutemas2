import bpy
from pathlib import Path
from mathutils import Vector
root=Path(r'E:/Dropbox/Приложения/remotely-save/LearnANDThink/Зрелищные здания/img/taipei-performing-arts-center/model/blender-review-v03')
bpy.ops.wm.open_mainfile(filepath=str(root/'tpac-master-v03.blend'))
cam=bpy.data.objects['02_blue_box'];cam.location=(160,-24, 62);cam.rotation_euler=(Vector((0,0,24))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=48
cam['alignment']='Corrected to opposite facade: globe at image right; approximate camera, geometry discrepancies remain'
bpy.context.scene.camera=cam
bpy.context.scene.render.filepath=str(root/'review/02_blue_box_corrected.png')
bpy.ops.wm.save_as_mainfile(filepath=str(root/'tpac-master-v03-camera02.blend'))
bpy.ops.render.render(write_still=True)

