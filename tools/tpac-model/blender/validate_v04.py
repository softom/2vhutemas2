import bpy,json
from pathlib import Path
root=Path(r'E:/Dropbox/Приложения/remotely-save/LearnANDThink/Зрелищные здания/img/taipei-performing-arts-center/model/blender-v04')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'tpac-v04.glb'))
objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
assert len(objects)>100
for required in ['Rear technical spine','Rear east tower','Recessed ribbon glazing','Continuous service ramp']:
 assert bpy.data.objects.get(required) is not None,required
assert not any(o.type in {'LIGHT','CAMERA'} for o in bpy.context.scene.objects)
report={'reimport_ok':True,'mesh_objects':len(objects),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects),'materials':len(bpy.data.materials),'bytes':(root/'tpac-v04.glb').stat().st_size}
(root/'validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print('VALIDATED',report)
