import bpy, json, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(r'E:/Dropbox/Приложения/remotely-save/LearnANDThink/Зрелищные здания/img/taipei-performing-arts-center/model')
OUT=ROOT/'blender-review-v03'
OUT.mkdir(exist_ok=True)
(OUT/'review').mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'prototype-v02/tpac-study-v02.glb'))
scene=bpy.context.scene
scene.unit_settings.system='METRIC'
scene['review_status']='Baseline audit; geometry unchanged; cameras approximate, not calibrated'
scene['source']='prototype-v02/tpac-study-v02.glb; does not include unsaved GUI edits'
meshes=[o for o in scene.objects if o.type=='MESH']
for o in meshes:o['audit_source']='v02'
# neutral studio environment for shape inspection
scene.world=bpy.data.worlds.new('Review world');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.65,.7,.75,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.6
ld=bpy.data.lights.new('Review sun','SUN');lo=bpy.data.objects.new('Review sun',ld);scene.collection.objects.link(lo);lo.rotation_euler=(.45,-.5,-.5);ld.energy=2
cams=[('01_globe_street',(110,-150,32),(0,-4,25),'03-taipei-performing-arts-center-c-oma-photography-by-chris-stowers.jpg',48),('02_blue_box',(-125,70,42),(-8,0,24),'06-taipei-performing-arts-center-c-oma-photography-by-chris-stowers.jpg',48),('03_roof_site',(-110,130,100),(0,0,18),'07-taipei-performing-arts-center-c-oma-photography-by-chris-stowers.jpg',45)]
# Three.js X,Y,Z becomes Blender X,-Z,Y on glTF import; globe is Blender +Y.
for name,pos,target,ref,lens in cams:
 pos=(pos[0],-pos[1],pos[2]);target=(target[0],-target[1],target[2])
 data=bpy.data.cameras.new(name);obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=pos;obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler();data.lens=lens
 data.show_background_images=True;bg=data.background_images.new();bg.image=bpy.data.images.load(str(ROOT/'photos'/ref),check_existing=True);bg.alpha=.35
 obj['reference']=ref;obj['alignment']='Initial comparable direction only, not camera-matched'
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=12
scene.render.resolution_x=960;scene.render.resolution_y=720;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.camera=bpy.data.objects[cams[0][0]]
report={'source':scene['source'],'blender':bpy.app.version_string,'mesh_objects':len(meshes),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes),'materials':len(bpy.data.materials),'cameras':[{'name':c[0],'reference':c[3],'calibrated':False} for c in cams]}
(OUT/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'tpac-review-v03.blend'))
for name,*_ in cams:
 scene.camera=bpy.data.objects[name];scene.render.filepath=str(OUT/'review'/f'{name}.png');bpy.ops.render.render(write_still=True)
print('REVIEW_COMPLETE',json.dumps(report))
