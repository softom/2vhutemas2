"""TPAC v05: bounded geometry refinement of the appended v04 scene. No shader edits."""
import bpy, math, json
from mathutils import Vector
s=bpy.context.scene
assert s.name=='TPAC_work_v05' and not s.get('v05_geometry_applied')
mat=bpy.data.materials
metal=mat['v04 aluminium']; frame=mat['v04 frames']; dark=mat['v04 technical cladding']; concrete=mat['v04 concrete']
def box(name,loc,size,material):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object;o.name=name;o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(material);return o
def beam(name,a,b,width,material):
    a,b=Vector(a),Vector(b)
    o=box(name,(a+b)/2,(width,width,(b-a).length),material)
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o
def curve(name,points,radius,material):
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=1;c.bevel_depth=radius;c.bevel_resolution=0
    p=c.splines.new('POLY');p.points.add(len(points)-1)
    for v,co in zip(p.points,points):v.co=(*co,1)
    o=bpy.data.objects.new(name,c);s.collection.objects.link(o);c.materials.append(material);return o
# Keep exact v04 cameras and create separate comparison-camera refinements.
for name in ['01_globe_street','02_blue_box','03_roof_site']:
    cam=s.objects[name];old=cam.copy();old.data=cam.data.copy();old.name=name+'_v04';s.collection.objects.link(old)
cam=s.objects['02_blue_box'];cam.location=(160,-48,74)
cam.rotation_euler=(Vector((2,-3,23))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.lens=48;cam['alignment']='Photographic direction refined; not point-calibrated'
# Widen hall face, increase its height and preserve the recessed window topology.
hall=s.objects['Grand Theater']
for v in hall.data.vertices:
    x,y,z=v.co
    t=max(0,min(1,(x-22)/29))
    old_bottom=11+9*t;new_bottom=11+5*t
    v.co.y=-2+(y+2)*(44-4*t)/(32-6*t)
    v.co.z=new_bottom+(z-old_bottom)/(32-old_bottom)*(36-new_bottom)
hall.data.update()
# Align window glazing and mullions with the same affine transform at their depth.
for o in s.objects:
    if o.name=='Recessed ribbon glazing' or o.name.startswith('Ribbon mullion'):
        t=max(0,min(1,(o.location.x-22)/29));scale_y=(44-4*t)/(32-6*t);scale_z=(36-(11+5*t))/(32-(11+9*t))
        o.location.y=-2+(o.location.y+2)*scale_y
        o.location.z=11+5*t+(o.location.z-(11+9*t))*scale_z
        o.scale.y*=scale_y;o.scale.z*=scale_z
# Rebuild only the four earlier hall supports, leaving the other volumes untouched.
for o in list(s.objects):
    if o.name.startswith('Hall inclined support'):bpy.data.objects.remove(o,do_unlink=True)
for side in [-1,1]:
    beam('v05 Hall V support',(47,side*14,.2),(47,side*4,15.9),.85,frame)
    beam('v05 Hall vertical support',(47,side*16,.2),(47,side*16,15.9),1.05,frame)
# Fine panel joints follow the shell instead of loose GLTF line primitives.
for o in list(s.objects):
    if o.name.startswith(('Globe horizontal panel seam','Globe meridian panel seam')):
        bpy.data.objects.remove(o,do_unlink=True)
for j in range(12):
    a=j*math.tau/12
    pts=[(-2+17.018*math.cos(-math.pi/2+i*math.pi/64)*math.cos(a),
          30+15.998*math.cos(-math.pi/2+i*math.pi/64)*math.sin(a),
          30+16.508*math.sin(-math.pi/2+i*math.pi/64)) for i in range(65)]
    curve('v05 Globe meridian joint',pts,.016,frame)
for degrees in [-60,-40,-20,0,20,40,60]:
    a=math.radians(degrees)
    pts=[(-2+17.018*math.cos(a)*math.cos(i*math.tau/96),
          30+15.998*math.cos(a)*math.sin(i*math.tau/96),
          30+16.508*math.sin(a)) for i in range(97)]
    curve('v05 Globe horizontal joint',pts,.016,frame)
# Hall sheet joints and finer dark tower ribs: subordinate to the major volumes.
for y in range(-20,19,3):
    box('v05 Hall panel joint',(51.018,y,26),(.025,.026,19.9),frame)
for y in [i*.55-30.5 for i in range(21)]:
    box('v05 East tower rib',(24.025,y,28),(.045,.026,55.8),frame)
for x in [i*.6-22.8 for i in range(79)]:
    height=54 if x < -11 else 56 if x>12 else 48
    box('v05 Rear tower rib',(x,-31.035 if x < -11 or x>12 else -30.035,height/2),(.026,.045,height-.2),frame)
# Readable floor structure and braces on the glazed face above the projecting hall.
for y in [-20,-6,8,20]:
    box('v05 Glazed facade column',(22.32,y,43),(.28,.28,13.8),frame)
for a,b in [((22.35,-20,49),(22.35,-6,36)),((22.35,-6,36),(22.35,8,49)),((22.35,8,49),(22.35,20,36))]:
    beam('v05 Upper facade brace',a,b,.38,dark)
# Roof terrace boundary, with public-space elements kept schematic.
for a,b in [((-48,-15,28.4),(-23,-15,28.4)),((-48,9,28.4),(-23,9,28.4)),((-48,-15,28.4),(-48,9,28.4))]:
    curve('v05 Terrace rail',[a,b],.055,frame)
# Actual loading bridge endpoints and supports, with a level tie-in.
bridge=s.objects['Loading bridge']
for x,y in [(33,-31.5),(22,-28.3)]:
    box('v05 Loading bridge pier',(x,y,2.8),(.6,.6,5.6),concrete)
s['v05_geometry_applied']=True
s['revision']='v05 photographic study; geometry refinement and export optimization'
s['limitations']='Approximate dimensions; cameras not calibrated; interiors and unseen connections not reconstructed.'
s.camera=s.objects['02_blue_box']
s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=16
s.render.resolution_x=1000;s.render.resolution_y=750;s.render.resolution_percentage=100
s.render.image_settings.file_format='PNG'
bpy.context.view_layer.update()
print(json.dumps({'scene':s.name,'objects':len(s.objects),'hall_bbox':[list(s.objects['Grand Theater'].matrix_world@Vector(p)) for p in s.objects['Grand Theater'].bound_box],'cameras_preserved':3}))


