"""Save a scene-only master; optimize a separate scene, then round-trip GLB."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
out=Path(r'E:/Dropbox/Приложения/remotely-save/LearnANDThink/Зрелищные здания/img/taipei-performing-arts-center/model/blender-v06')
master=bpy.context.scene
assert master.name=='TPAC_work_v06'
def stats(scene):
    deps=bpy.context.evaluated_depsgraph_get();tris=0;mesh_count=0;bounds=[]
    for ob in scene.objects:
        if ob.type not in {'MESH','CURVE'}:continue
        eo=ob.evaluated_get(deps);me=eo.to_mesh();me.calc_loop_triangles()
        if not me.polygons:eo.to_mesh_clear();continue
        mesh_count+=1;tris+=len(me.loop_triangles)
        bounds.extend([ob.matrix_world@v.co for v in me.vertices])
        eo.to_mesh_clear()
    return {'mesh_objects':mesh_count,'triangles':tris,'bounds_min':[min(v[i] for v in bounds) for i in range(3)],'bounds_max':[max(v[i] for v in bounds) for i in range(3)]}
master.camera=master.objects['v06 02_grand_theater']
master['units']='Approximate metres'
master['sources']='Chris Stowers / OMA photos 03,06,07; Architectural Record plan 14. Sources and rights in ../sources.csv'
master_metrics=stats(master)
# Save only this scene and all its dependencies. Other user scenes remain in memory.
bpy.data.libraries.write(str(out/'tpac-master-v06.blend'),{master},fake_user=True,compress=True)
export_scene=bpy.data.scenes.new('TPAC_export_v06')
deps=bpy.context.evaluated_depsgraph_get()
groups={}
for ob in list(master.objects):
    if ob.type not in {'MESH','CURVE'}:continue
    evaluated=ob.evaluated_get(deps)
    me=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=deps)
    if len(me.polygons)==0:bpy.data.meshes.remove(me);continue
    new=bpy.data.objects.new(ob.name,me);export_scene.collection.objects.link(new);new.matrix_world=ob.matrix_world.copy()
    n=ob.get('source_name',ob.name.removeprefix('v06 '))
    category=('Circulation' if any(t in n for t in ['Grand stair','Grand circulation','Grand lift']) else 'Entry' if any(t in n for t in ['Foyer','foyer','Recessed','Main stair','Lobby','Raised foyer']) else 'Globe' if 'Globe' in n else 'Grand Theater' if n=='Grand Theater' or 'Hall' in n or 'Ribbon mullion' in n or 'Recessed ribbon' in n else 'Blue Box' if 'Blue Box' in n or 'Terrace' in n or 'Roof circular' in n else 'Service' if any(t in n for t in ['Rear','tower','Loading','ramp','Public loop','Public circulation']) else 'Building' if any(t in n for t in ['glass','glazing','Facade','facade','Glazed','Roof','lobby','Podium','Entry','Entrance','Canopy','Door']) else 'Site')
    key=(category,tuple(m.name if m else '' for m in me.materials))
    groups.setdefault(key,[]).append(new)
bpy.context.window.scene=export_scene
for (category,materials),objects in groups.items():
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:ob.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    if len(objects)>1:bpy.ops.object.join()
    ob=bpy.context.view_layer.objects.active;ob.name=category+' / '+(materials[0] if materials else 'surface')
export_metrics=stats(export_scene)
assert export_metrics['triangles']==master_metrics['triangles'],(export_metrics,master_metrics)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(out/'tpac-v06.glb'),export_format='GLB',use_active_scene=True,use_selection=True,export_apply=True,export_cameras=False,export_lights=False)
check=bpy.data.scenes.new('TPAC_GL B_check_v06');bpy.context.window.scene=check
bpy.ops.import_scene.gltf(filepath=str(out/'tpac-v06.glb'))
import_metrics=stats(check)
assert import_metrics['triangles']==export_metrics['triangles']
assert not any(o.type in {'CAMERA','LIGHT'} for o in check.objects)
for key in ['bounds_min','bounds_max']:
    assert max(abs(a-b) for a,b in zip(import_metrics[key],export_metrics[key]))<.02
assert any(o.name.startswith('Globe') for o in check.objects)
assert any(o.name.startswith('Grand Theater') for o in check.objects)
report={'master':master_metrics,'export':export_metrics,'roundtrip':import_metrics,'bytes':(out/'tpac-v06.glb').stat().st_size,'materials':len({m.name for o in check.objects if o.type=='MESH' for m in o.data.materials if m}),'roundtrip_passed':True,'cameras_calibrated':False,'independent_backup_verified':False}
(out/'validation.json').write_text(json.dumps(report,indent=2),encoding='utf8')
bpy.context.window.scene=master
# Remove disposable scenes and only their own copied objects.
for scene in [export_scene,check]:
    for ob in list(scene.objects):bpy.data.objects.remove(ob,do_unlink=True)
    bpy.data.scenes.remove(scene)
print(json.dumps(report))
