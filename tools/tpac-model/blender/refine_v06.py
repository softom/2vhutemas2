"""TPAC v06: independent scene copy; ground permeability and circulation corrections."""
import bpy, math, json
from mathutils import Vector
source=bpy.data.scenes['TPAC_work_v05']
assert 'TPAC_work_v06' not in bpy.data.scenes
s=bpy.data.scenes.new('TPAC_work_v06')
s.world=source.world
s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=20
s.render.resolution_x=1200;s.render.resolution_y=850;s.render.resolution_percentage=100
s.render.image_settings.file_format='PNG'
copies={}
for old in source.objects:
    ob=old.copy()
    if old.data:ob.data=old.data.copy()
    ob.name='v06 '+old.name;ob['source_name']=old.name
    s.collection.objects.link(ob);copies[old.name]=ob
for old in source.objects:
    ob=copies[old.name];world=old.matrix_world.copy()
    ob.parent=copies.get(old.parent.name) if old.parent else None
    ob.matrix_world=world
bpy.context.window.scene=s
s.camera=copies['02_blue_box'];s.camera.name='v06 02_grand_theater'
s['revision']='v06 ground permeability and circulation corrections'
s['sources']='OMA official staircase photograph; Record plan 14; TPAC ADAM 2024 p2; Stowers 05 06 07 11'
s['limitations']='Approximate dimensions and lift shaft envelope; no surveyed interiors or camera calibration.'
materials=bpy.data.materials
concrete=materials['v04 concrete'];frame=materials['v04 frames'];metal=materials['v04 aluminium'];dark=materials['v04 technical cladding'];glass=materials['v04 glazing']
removed=[]
prefixes=('Entry step','Door frame','Canopy support','Entrance bollard')
for name,ob in list(copies.items()):
    if name in {'Ground lobby','Podium','Entry glass doors','Entrance canopy'} or name.startswith(prefixes):
        removed.append(name);bpy.data.objects.remove(ob,do_unlink=True);del copies[name]
def box(name,loc,size,material):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object;o.name='v06 '+name;o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(material);return o
def beam(name,a,b,width,material):
    a,b=Vector(a),Vector(b);o=box(name,(a+b)/2,(width,width,(b-a).length),material)
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o
def line(name,pts,r=.035,material=frame):
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=0
    sp=c.splines.new('POLY');sp.points.add(len(pts)-1)
    for p,v in zip(sp.points,pts):p.co=(*v,1)
    ob=bpy.data.objects.new('v06 '+name,c);s.collection.objects.link(ob);c.materials.append(material);return ob
def mesh(name,vs,fs,material):
    me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update()
    ob=bpy.data.objects.new('v06 '+name,me);s.collection.objects.link(ob);me.materials.append(material);return ob
def cut(target,cutter):
    bpy.context.view_layer.objects.active=target
    m=target.modifiers.new('Circulation opening','BOOLEAN');m.operation='DIFFERENCE';m.solver='EXACT';m.object=cutter
    bpy.ops.object.modifier_apply(modifier=m.name)
# Thin suspended soffit; no plinth at the pedestrian level.
slab=box('Raised foyer slab',(0,0,6.75),(44,44,.5),concrete)
opening=box('temporary foyer opening',(-1,-1,7.3),(10,15,2.4),concrete)
cut(slab,opening);cut(copies['Central glass volume'],opening)
bpy.data.objects.remove(opening,do_unlink=True)
# Existing supports remain; add the inner supports seen at the lobby stair.
for x in [-9,9]:
    for y in [-10,7]:
        box('Foyer column',(x,y,3.25),(.7,.7,6.5),concrete)
# Recessed entrance at y=7, 15m behind the cube's sphere-side edge.
for x in [-6.7,6.7]:
    box('Recessed entry glazing',(x,7,2.6),(4.6,.10,5.1),glass)
for x in [-9,9]:
    box('Lobby side glazing',(x,-2,2.6),(.10,18,5.1),glass)
box('Lobby rear wall',(0,-11,2.6),(18,.12,5.1),glass)
for x in [-9,-4.4,4.4,9]:
    box('Recessed entrance jamb',(x,7,2.6),(.11,.18,5.2),frame)
# Sliding doors shown as parked leaves beside the clear central entry.
for x in [-3.65,3.65]:
    box('Recessed sliding door',(x,7.12,1.7),(1.45,.10,3.35),glass)
box('Recessed entrance head',(0,7,3.45),(8.8,.22,.18),frame)
# Grand stair rises within the cube, not at the sphere supports.
n=38;run=13.0;rise=6.6
for i in range(n):
    z=.08+(i+1)*rise/n;y=6.2-(i+.5)*run/n
    box('Foyer stair tread',(-1,y,z-.07),(5.8,run/n+.015,.14),concrete)
beam('Foyer stair stringer',(-3.8,6.4,.1),(-3.8,-7,6.55),.22,frame)
beam('Foyer stair stringer',(1.8,6.4,.1),(1.8,-7,6.55),.22,frame)
for x in [-3.9,1.9]:
    line('Foyer stair handrail',[(x,6.4,1.05),(x,-7,7.6)],.045)
    for i in range(0,n,4):
        y=6.2-(i+.5)*run/n;z=.08+(i+1)*rise/n
        beam('Foyer rail post',(x,y,z),(x,y,z+1),.045,frame)
box('Foyer upper landing',(-1,-8,6.7),(7,2.4,.3),concrete)
# A side escalator is represented separately, preserving the entry circulation.
beam('Foyer escalator body',(4.5,6.4,.18),(4.5,-7,6.75),1.25,dark)
for x in [3.8,5.2]:line('Foyer escalator rail',[(x,6.4,1.0),(x,-7,7.55)],.07)
# Lift envelope by the internal lobby service core, from the official map.
box('Foyer lift shaft',(-6,-14,3.3),(3.1,3.2,6.6),metal)
for x in [-6.55,-5.45]:box('Foyer lift door',(x,-12.37,1.2),(1.06,.06,2.4),frame)
# External switchback stair next to the Grand Theater support.
# Plan14 locates a circulation box at the outer end; OMA close-up shows the leaning mesh cage.
# Six flights rise to the underside. The width/shaft internals remain approximate.
height=15.0;flights=6;run=5.4;steps=15;bottom_x=48.0;shift=-4.5;cy=13.5
for f in range(flights):
    z0=f*height/flights;z1=(f+1)*height/flights
    xcenter=bottom_x+shift*(z0+z1)/(2*height)+(-1.05 if f%2==0 else 1.05)
    ya=cy-run/2 if f%2==0 else cy+run/2;yb=cy+run/2 if f%2==0 else cy-run/2
    for i in range(steps):
        t=(i+.5)/steps;z=z0+(i+1)*(z1-z0)/steps
        box('Grand circulation stair tread',(xcenter,ya+(yb-ya)*t,z-.06),(1.85,run/steps+.015,.12),metal)
    for dx in [-.92,.92]:
        beam('Grand circulation stair stringer',(xcenter+dx,ya,z0),(xcenter+dx,yb,z1),.12,frame)
        line('Grand circulation handrail',[(xcenter+dx,ya,z0+1),(xcenter+dx,yb,z1+1)],.032)
    landing_x=bottom_x+shift*z1/height
    box('Grand circulation landing',(landing_x,yb,z1-.10),(4.8,1.35,.20),metal)
# Leaning cage: outer rails and sparse mesh rods leave stairs visible.
for y in [cy-3.6,cy+3.6]:
    for dx in [-2.65,2.65]:
        beam('Grand stair cage upright',(bottom_x+dx,y,0),(bottom_x+shift+dx,y,height),.10,frame)
    for k in range(1,38):
        z=k*height/38;xc=bottom_x+shift*z/height
        line('Grand stair cage mesh',[(xc-2.65,y,z),(xc+2.65,y,z)],.011,frame)
    for k in range(1,15):
        dx=-2.65+k*5.3/15
        line('Grand stair cage mesh',[(bottom_x+dx,y,0),(bottom_x+shift+dx,y,height)],.011,frame)
for dx in [-2.65,2.65]:
    for k in range(1,38):
        z=k*height/38;xc=bottom_x+shift*z/height+dx
        line('Grand stair cage mesh',[(xc,cy-3.6,z),(xc,cy+3.6,z)],.011,frame)
# Narrow vertical service/lift envelope adjacent to the circulation structure.
# Exterior envelope only: number and machinery of lifts are unconfirmed.
box('Grand lift shaft envelope',(41.5,16.2,7.55),(3.1,3.1,15.1),metal)
for y in [15.6,16.8]:
    box('Grand lift door',(43.08,y,1.22),(.08,1.12,2.44),frame)
box('Grand lift threshold',(44,16.2,.1),(1.8,3.1,.2),concrete)
# Existing entry mislabelling is corrected, original camera directions are retained.
for name in ['01_globe_street','03_roof_site']:
    copies[name].name='v06 '+name
def camera(name,pos,target,lens=38):
    d=bpy.data.cameras.new(name);o=bpy.data.objects.new(name,d);s.collection.objects.link(o);o.location=pos
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();d.lens=lens;return o
camera('v06 04_circulation',(88,45,8),(39,10,9),42)
camera('v06 05_open_ground',(52,69,6),(0,4,3.8),40)
camera('v06 06_recessed_entry',(7,34,3.2),(-1,0,3),30)
s.camera=bpy.data.objects['v06 05_open_ground']
s['ground_entry_footprint_m2']=18*18
s['ground_cube_footprint_m2']=44*44
s['lift_envelope_status']='Approximate external envelope; internal number and positions not surveyed.'
s['v06_applied']=True
bpy.context.view_layer.update()
print(json.dumps({'scene':s.name,'objects':len(s.objects),'removed':removed,'entry_recess_from_cube_edge':15,'source_scene_objects':len(source.objects)}))

