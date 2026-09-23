import bpy,math,json
from mathutils import Vector
sc=bpy.context.scene
assert sc.name=='TPAC_work_v05'
# The earlier metal texture is a coarse checkerboard; share the reviewed metal.
sc.objects['Blue Box'].data.materials.clear()
sc.objects['Blue Box'].data.materials.append(bpy.data.materials['v04 aluminium'])
# Public circulation loop visible on plan 14 and rear photograph 07.
# Schematic grades and radii, explicitly not a construction ramp design.
vs=[];fs=[];segments=64
for i in range(segments+1):
    a=math.radians(-55+270*i/segments)
    z=5.9-4.4*i/segments
    for rx,ry,dz in [(19,17,0),(22,20,0),(19,17,-.22),(22,20,-.22)]:
        vs.append((-35+rx*math.cos(a),-10+ry*math.sin(a),z+dz))
for i in range(segments):
    a=i*4;b=a+4
    fs.extend([(a,a+1,b+1,b),(a+2,b+2,b+3,a+3),(a,b,b+2,a+2),(a+1,a+3,b+3,b+1)])
fs.extend([(0,2,3,1),(4*segments,4*segments+1,4*segments+3,4*segments+2)])
me=bpy.data.meshes.new('v05 Public circulation loop');me.from_pydata(vs,[],fs);me.update()
o=bpy.data.objects.new('v05 Public circulation loop',me);sc.collection.objects.link(o);me.materials.append(bpy.data.materials['v04 concrete'])
for rx,ry in [(19,17),(22,20)]:
    cu=bpy.data.curves.new('v05 Public loop rail','CURVE');cu.dimensions='3D';cu.bevel_depth=.06;cu.bevel_resolution=0
    sp=cu.splines.new('POLY');sp.points.add(segments)
    for i,p in enumerate(sp.points):
        a=math.radians(-55+270*i/segments);p.co=(-35+rx*math.cos(a),-10+ry*math.sin(a),6.9-4.4*i/segments,1)
    ob=bpy.data.objects.new('v05 Public loop rail',cu);sc.collection.objects.link(ob);cu.materials.append(bpy.data.materials['v04 frames'])
sc['public_loop']='Photographic interpretation from Record plan 14 and Stowers 07, approximate grade'
print('public loop added; shared metal assigned')

