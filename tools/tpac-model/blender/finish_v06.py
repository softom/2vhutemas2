import bpy,json
from mathutils import Vector
s=bpy.context.scene
assert s.name=='TPAC_work_v06'
removed=[]
for o in list(s.objects):
    if o.name.startswith(('v06 v05 Hall V support','v06 v05 Hall vertical support')):
        removed.append(o.name);bpy.data.objects.remove(o,do_unlink=True)
def beam(name,a,b,w):
    a,b=Vector(a),Vector(b);bpy.ops.mesh.primitive_cube_add(size=1,location=(a+b)/2)
    o=bpy.context.object;o.name=name;o.dimensions=(w,w,(b-a).length)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();o.data.materials.append(bpy.data.materials['v04 frames'])
beam('v06 Grand inclined column',(50,-13,0),(44,-13,14.8),1.05)
beam('v06 Grand inner inclined column',(45,4,0),(40,4,14.0),1.0)
# Move the lift envelope clear of the stair footprint.
for o in s.objects:
    if o.name.startswith(('v06 Grand lift shaft','v06 Grand lift door','v06 Grand lift threshold')):
        o.location.y-=8.7;o.location.x+=2.5
# Review illumination, separate from the exported model.
for name,pos,target,energy,size in [
 ('v06 Review plaza fill',(28,35,14),(0,0,3),6500,25),
 ('v06 Review lobby fill',(0,2,5.9),(0,0,0),900,8)]:
    d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.shape='DISK';d.size=size
    o=bpy.data.objects.new(name,d);s.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
print({'removed_old_supports':removed,'lift_clear_of_stair':True})

