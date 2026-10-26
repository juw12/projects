"""Kobo-chan: a reference-inspired 100 mm figurine, Form 3 geometry revision.

Requires cadquery-ocp, numpy, vtk and Pillow. No native CAD application is used.
Run: python build_kobochan.py --height 100
All lengths are mm. Front is -Y, vertical is +Z. The STEP is one colored
boundary-representation solid, NOT a recovered Creo/SOLIDWORKS feature tree.
The angled STL is an unsupported orientation candidate, not a Formlabs print job.
Use PreForm to select the actual resin and generate/review supports before printing.

Shape references (artistic interpretation, not a scan or exact replica):
https://eiken-anime.jp/works/%E3%82%B3%E3%83%9C%E3%81%A1%E3%82%83%E3%82%93
https://www.japan-programcatalog.com/en/program/kobochan
https://dragonflower.tokyo/kobo/
The yellow shirt, broad green stripe and shorts follow the cartoon reference.
"""

import argparse
import json
import math
from pathlib import Path
import struct

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_GTransform,
    BRepBuilderAPI_MakeEdge,
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakeWire,
    BRepBuilderAPI_Transform,
)
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepOffsetAPI import BRepOffsetAPI_MakePipe, BRepOffsetAPI_ThruSections
from OCP.BRepPrimAPI import (
    BRepPrimAPI_MakeBox,
    BRepPrimAPI_MakeCone,
    BRepPrimAPI_MakeCylinder,
    BRepPrimAPI_MakePrism,
    BRepPrimAPI_MakeSphere,
)
from OCP.Bnd import Bnd_Box
from OCP.Geom import Geom_BezierCurve
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.Quantity import Quantity_Color, Quantity_TOC_RGB
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.collections import Array1_gp_Pnt
from OCP.TDataStd import TDataStd_Name
from OCP.TDocStd import TDocStd_Document
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED, TopAbs_SHELL, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.XCAFDoc import XCAFDoc_ColorSurf, XCAFDoc_DocumentTool
from OCP.gp import (
    gp_Ax1,
    gp_Ax2,
    gp_Circ,
    gp_Dir,
    gp_Elips,
    gp_GTrsf,
    gp_Mat,
    gp_Pnt,
    gp_Trsf,
    gp_Vec,
)

REFERENCE_HEIGHT = 100.0
BASE_RADII = (23.0, 16.0)
BASE_THICKNESS = 4.0
HEAD_CENTER_Z = 76.2
HEAD_RADII = (12.7, 10.7, 17.0)
CROWN_TIP_RADIUS = 1.2
CROWN_BASE_RADIUS = 1.6
FORM3_TILT_DEGREES = -25.0
FORM3_BUILD_VOLUME = np.array([145.0, 145.0, 185.0])
MESH_DEFLECTION = 0.025
MESH_ANGLE = 0.10

COLORS = {
    "skin": (0.96, 0.68, 0.43),
    "hair": (0.055, 0.065, 0.10),
    "shirt": (1.0, 0.66, 0.09),
    "green": (0.09, 0.29, 0.22),
    "sock": (0.96, 0.93, 0.81),
    "shoe": (0.88, 0.91, 0.85),
    "sole": (0.26, 0.35, 0.32),
    "mouth": (0.26, 0.075, 0.055),
    "ear": (0.84, 0.42, 0.27),
    "base": (0.11, 0.19, 0.21),
}


def subshapes(shape, kind):
    explorer = TopExp_Explorer(shape, kind)
    while explorer.More():
        item = explorer.Current()
        yield TopoDS.Face(item) if kind == TopAbs_FACE else item
        explorer.Next()


def ellipsoid(center, radii, tilt=0.0):
    # Two meridian patches avoid ambiguous periodic B-spline trims in STEP.
    # A single periodic patch can change its chosen trimmed region on export.
    first_half = BRepPrimAPI_MakeSphere(1, math.pi).Shape()
    second_half = BRepPrimAPI_MakeSphere(
        gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(-1, 0, 0)),
        1,
        math.pi,
    ).Shape()
    sphere = BRepAlgoAPI_Fuse(first_half, second_half).Shape()
    transform = gp_GTrsf()
    transform.SetVectorialPart(gp_Mat(
        radii[0], 0, 0,
        0, radii[1], 0,
        0, 0, radii[2],
    ))
    shape = BRepBuilderAPI_GTransform(
        sphere, transform, True
    ).Shape()
    placement = gp_Trsf()
    if tilt:
        placement.SetRotation(
            gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)), math.radians(tilt)
        )
    placement.SetTranslationPart(gp_Vec(*center))
    return BRepBuilderAPI_Transform(shape, placement, True).Shape()


def box(low, high):
    return BRepPrimAPI_MakeBox(gp_Pnt(*low), gp_Pnt(*high)).Shape()


def boolean(first, second, operation="fuse"):
    factory = {
        "fuse": BRepAlgoAPI_Fuse,
        "cut": BRepAlgoAPI_Cut,
        "common": BRepAlgoAPI_Common,
    }[operation]
    builder = factory(first, second)
    builder.Build()
    if not builder.IsDone():
        raise RuntimeError(f"Boolean operation failed: {operation}")
    return builder.Shape()


def fuse(shapes):
    result = shapes[0]
    for item in shapes[1:]:
        result = boolean(result, item)
    return result


def ellipse_wire(z, rx, ry, x=0.0, y=0.0):
    if rx >= ry:
        axes = gp_Ax2(gp_Pnt(x, y, z), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0))
        ellipse = gp_Elips(axes, rx, ry)
    else:
        axes = gp_Ax2(gp_Pnt(x, y, z), gp_Dir(0, 0, 1), gp_Dir(0, 1, 0))
        ellipse = gp_Elips(axes, ry, rx)
    return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(ellipse).Edge()).Wire()


def ellipse_loft(sections, x=0.0, y=0.0, ruled=False):
    builder = BRepOffsetAPI_ThruSections(True, ruled, 1e-7)
    for z, rx, ry in sections:
        builder.AddWire(ellipse_wire(z, rx, ry, x, y))
    builder.Build()
    if not builder.IsDone():
        raise RuntimeError("Loft failed")
    return builder.Shape()


def tapered_round_bar(start, end, radius_start, radius_end):
    vector = np.asarray(end, dtype=float) - start
    length = np.linalg.norm(vector)
    axis = gp_Ax2(gp_Pnt(*start), gp_Dir(*vector))
    if abs(radius_start - radius_end) < 1e-8:
        middle = BRepPrimAPI_MakeCylinder(axis, radius_start, length).Shape()
    else:
        middle = BRepPrimAPI_MakeCone(
            axis, radius_start, radius_end, length
        ).Shape()
    return fuse([
        middle,
        BRepPrimAPI_MakeSphere(gp_Pnt(*start), radius_start).Shape(),
        BRepPrimAPI_MakeSphere(gp_Pnt(*end), radius_end).Shape(),
    ])


def bezier(points):
    poles = Array1_gp_Pnt(1, len(points))
    for index, point in enumerate(points, 1):
        poles.SetValue(index, gp_Pnt(*point))
    return Geom_BezierCurve(poles)


def curved_bar(points, radius):
    curve = bezier(points)
    path = BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(curve).Edge()).Wire()
    tangent = np.asarray(points[1]) - points[0]
    circle = gp_Circ(gp_Ax2(gp_Pnt(*points[0]), gp_Dir(*tangent)), radius)
    wire = BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(circle).Edge()).Wire()
    profile = BRepBuilderAPI_MakeFace(wire).Face()
    return BRepOffsetAPI_MakePipe(path, profile).Shape()


def scalloped_hair_cap():
    """A close-fitting dome with a cut scalloped edge, not separate hair blobs."""
    cap = ellipsoid((0, 0.15, 76.2), (13.25, 11.3, 17.5))
    cap = boolean(cap, box((-30, -30, 81.0), (30, 30, 110)), "common")
    boundaries = [-15.0, -10.5, -5.8, 0.0, 5.4, 10.2, 15.0]
    peaks = [86.5, 86.5, 86.2, 86.8, 86.6, 86.5, 86.5]
    tips = [83.7, 83.2, 82.9, 83.5, 83.5, 84.0]
    outline = BRepBuilderAPI_MakeWire()
    y = -25.0
    for index, (left, right) in enumerate(zip(boundaries, boundaries[1:])):
        middle = (left + right) / 2
        low_z = tips[index]
        first_half = bezier([
            (left, y, peaks[index]),
            (left + 0.3, y, low_z + 0.8),
            (middle - 0.9, y, low_z),
            (middle, y, low_z),
        ])
        second_half = bezier([
            (middle, y, low_z),
            (middle + 0.9, y, low_z),
            (right - 0.3, y, low_z + 0.8),
            (right, y, peaks[index + 1]),
        ])
        outline.Add(BRepBuilderAPI_MakeEdge(first_half).Edge())
        outline.Add(BRepBuilderAPI_MakeEdge(second_half).Edge())
    closing_points = [
        (boundaries[-1], y, peaks[-1]),
        (boundaries[-1], y, 50.0),
        (boundaries[0], y, 50.0),
        (boundaries[0], y, peaks[0]),
    ]
    for start, end in zip(closing_points, closing_points[1:]):
        outline.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(*start), gp_Pnt(*end)).Edge())
    profile = BRepBuilderAPI_MakeFace(outline.Wire()).Face()
    front_trim = BRepPrimAPI_MakePrism(profile, gp_Vec(0, 25.3, 0)).Shape()
    cap = boolean(cap, front_trim, "cut")
    back_trim = box((-30, 0.3, 50), (30, 30, 85.8))
    return boolean(cap, back_trim, "cut")


class ColoredModel:
    def __init__(self, shape, material):
        self.shape = shape
        self.face_materials = {
            hash(face): material for face in subshapes(shape, TopAbs_FACE)
        }

    def add(self, shape, material, name, cut=False):
        print(f"  {'Cut' if cut else 'Add'}: {name}", flush=True)
        factory = BRepAlgoAPI_Cut if cut else BRepAlgoAPI_Fuse
        builder = factory(self.shape, shape)
        builder.Build()
        if not builder.IsDone():
            raise RuntimeError(f"Feature failed: {name}")
        updated = builder.Shape()
        final_faces = list(subshapes(updated, TopAbs_FACE))
        final_keys = {hash(face) for face in final_faces}
        mapped = {}
        for original, original_materials in (
            (self.shape, self.face_materials),
            (shape, {hash(face): material for face in subshapes(shape, TopAbs_FACE)}),
        ):
            for face in subshapes(original, TopAbs_FACE):
                color_name = original_materials.get(hash(face), material)
                if hash(face) in final_keys:
                    mapped[hash(face)] = color_name
                for modified in builder.Modified(face):
                    if hash(modified) in final_keys:
                        mapped[hash(modified)] = color_name
                for generated in builder.Generated(face):
                    if hash(generated) in final_keys:
                        mapped[hash(generated)] = color_name
        for face in final_faces:
            mapped.setdefault(hash(face), material)
        self.shape = updated
        self.face_materials = mapped

    def scale(self, factor):
        transform = gp_Trsf()
        transform.SetScale(gp_Pnt(0, 0, 0), factor)
        builder = BRepBuilderAPI_Transform(self.shape, transform, True)
        material_map = {}
        for face in subshapes(self.shape, TopAbs_FACE):
            transformed_face = builder.ModifiedShape(face)
            material_map[hash(transformed_face)] = self.face_materials[hash(face)]
        self.shape = builder.Shape()
        self.face_materials = material_map


def front_y(x, z):
    rx, ry, rz = HEAD_RADII
    return -ry * math.sqrt(max(0.001, 1 - (x / rx) ** 2 - ((z - HEAD_CENTER_Z) / rz) ** 2))


def build_figure():
    base = ellipse_loft([
        (0, 21.7, 14.7),
        (0.7, *BASE_RADII),
        (3.1, *BASE_RADII),
        (BASE_THICKNESS, 22.1, 15.1),
    ], ruled=True)
    model = ColoredModel(base, "base")

    for side in (-1, 1):
        x = side * 5.6
        sole = ellipse_loft([
            (3.7, 4.25, 6.65),
            (4.5, 4.45, 6.85),
            (5.4, 4.45, 6.85),
        ], x=x, y=-1.9, ruled=True)
        model.add(sole, "sole", f"shoe sole {side}")
        shoe = ellipsoid((x, -1.9, 6.8), (4.35, 6.8, 3.3))
        model.add(shoe, "shoe", f"rounded shoe {side}")
        leg = tapered_round_bar((x, 0, 8.7), (x, 0, 24.5), 3.0, 3.15)
        model.add(leg, "skin", f"lower leg {side}")
        sock = ellipse_loft([
            (8.0, 3.25, 3.15),
            (12.7, 3.25, 3.15),
            (13.6, 3.45, 3.35),
            (14.4, 3.45, 3.35),
        ], x=x, ruled=True)
        model.add(sock, "sock", f"sock and rolled top {side}")

    shorts = fuse([
        ellipsoid((-5.5, 0, 28.0), (5.6, 6.3, 9.5)),
        ellipsoid((5.5, 0, 28.0), (5.6, 6.3, 9.5)),
        ellipsoid((0, 0, 33), (10.4, 6.5, 4.7)),
    ])
    shorts = boolean(shorts, box((-30, -30, 21.8), (30, 30, 40)), "common")
    model.add(shorts, "green", "two-leg shorts with a real leg gap")

    torso = ellipse_loft([
        (32.2, 10.9, 7.3),
        (34.0, 10.8, 7.2),
        (41.5, 10.4, 7.1),
        (47.8, 9.5, 6.4),
        (53.0, 7.5, 5.4),
        (56.8, 5.0, 4.4),
    ])
    model.add(torso, "shirt", "soft short-sleeve shirt")
    stripe = ellipse_loft([
        (39.5, 10.72, 7.34),
        (42.5, 10.48, 7.30),
        (43.3, 10.36, 7.25),
    ])
    model.add(stripe, "green", "shallow raised chest stripe")

    for side in (-1, 1):
        arm = tapered_round_bar(
            (side * 12.6, 0.0, 44.0),
            (side * 18.3, -0.1, 35.8),
            2.65, 2.35,
        )
        model.add(arm, "skin", f"lowered arm {side}")
        sleeve = tapered_round_bar(
            (side * 7.8, 0.0, 50.0),
            (side * 12.7, 0.0, 43.3),
            4.0, 3.8,
        )
        model.add(sleeve, "shirt", f"rounded short sleeve {side}")
        cuff = tapered_round_bar(
            (side * 12.5, 0.0, 43.5),
            (side * 13.15, 0.0, 42.7),
            3.65, 3.5,
        )
        model.add(cuff, "green", f"sleeve trim {side}")
        hand = ellipsoid((side * 19.0, -0.2, 34.6), (2.6, 2.5, 3.4), side * 18)
        model.add(hand, "skin", f"mitten hand {side}")
        thumb = tapered_round_bar(
            (side * 17.5, -1.9, 35.5),
            (side * 17.4, -2.1, 34.1),
            1.2, 1.1,
        )
        model.add(thumb, "skin", f"attached thumb {side}")

    neck = tapered_round_bar((0, 0, 52.0), (0, 0, 61.2), 3.8, 4.0)
    model.add(neck, "skin", "short supported neck")
    collar = ellipse_loft([
        (55.0, 5.65, 4.9),
        (56.1, 5.2, 4.6),
        (57.0, 4.6, 4.2),
    ])
    model.add(collar, "green", "crew-neck collar")
    model.add(ellipsoid((0, 0, HEAD_CENTER_Z), HEAD_RADII), "skin", "tall rounded head")

    for side in (-1, 1):
        ear = ellipsoid((side * 12.05, 0, 71.8), (2.25, 2.7, 3.7), side * 9)
        model.add(ear, "skin", f"ear {side}")
        recess = ellipsoid((side * 13.0, -2.0, 71.9), (0.9, 1.0, 2.0), side * 9)
        model.add(recess, "ear", f"shallow ear hollow {side}", cut=True)

    model.add(scalloped_hair_cap(), "hair", "smooth cap with scalloped fringe")
    model.add(
        tapered_round_bar(
            (0.8, 0.3, 92.2),
            (1.6, 0.2, REFERENCE_HEIGHT - CROWN_TIP_RADIUS),
            CROWN_BASE_RADIUS,
            CROWN_TIP_RADIUS,
        ),
        "hair", "taller crown hair, rounded tip at 100 mm",
    )
    model.add(
        tapered_round_bar(
            (-1.2, 0.2, 92.3),
            (-2.6, 0.1, REFERENCE_HEIGHT - 2.0 - CROWN_TIP_RADIUS),
            CROWN_BASE_RADIUS,
            CROWN_TIP_RADIUS,
        ),
        "hair", "second crown hair",
    )

    for side in (-1, 1):
        xs = [side * 7.2, side * 5.3, side * 3.7, side * 2.4]
        zs = [78.7, 81.4, 81.1, 79.8]
        points = [
            (x, front_y(x, z) - 0.15, z) for x, z in zip(xs, zs)
        ]
        model.add(curved_bar(points, 0.36), "hair", f"arched eyebrow {side}")
        eye_x = side * 4.0
        eye_z = 72.9
        recess = ellipsoid(
            (eye_x, front_y(eye_x, eye_z) - 0.17, eye_z), (0.64, 0.65, 0.82)
        )
        model.add(recess, "hair", f"tiny inset eye {side}", cut=True)

    nose = ellipsoid((0, -10.45, 70.1), (1.2, 1.65, 1.25))
    model.add(nose, "skin", "small button nose")
    mouth_top = bezier([
        (-3.15, -12.0, 66.5),
        (-1.2, -12.0, 65.4),
        (1.2, -12.0, 65.4),
        (3.15, -12.0, 66.5),
    ])
    mouth_bottom = bezier([
        (3.15, -12.0, 66.5),
        (1.65, -12.0, 63.6),
        (-1.65, -12.0, 63.6),
        (-3.15, -12.0, 66.5),
    ])
    mouth_wire = BRepBuilderAPI_MakeWire()
    mouth_wire.Add(BRepBuilderAPI_MakeEdge(mouth_top).Edge())
    mouth_wire.Add(BRepBuilderAPI_MakeEdge(mouth_bottom).Edge())
    mouth_profile = BRepBuilderAPI_MakeFace(mouth_wire.Wire()).Face()
    mouth_tool = BRepPrimAPI_MakePrism(mouth_profile, gp_Vec(0, 5.1, 0)).Shape()
    model.add(mouth_tool, "mouth", "recessed crescent smile", cut=True)
    return model


def shape_metrics(shape):
    bounds = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, bounds, False, False)
    low = bounds.CornerMin()
    high = bounds.CornerMax()
    minimum = np.array([low.X(), low.Y(), low.Z()])
    maximum = np.array([high.X(), high.Y(), high.Z()])
    properties = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, properties, Eps=1e-8)
    center = properties.CentreOfMass()
    return {
        "valid_brep": BRepCheck_Analyzer(shape).IsValid(),
        "solid_count": len(list(subshapes(shape, TopAbs_SOLID))),
        "shell_count": len(list(subshapes(shape, TopAbs_SHELL))),
        "size_mm": (maximum - minimum).tolist(),
        "minimum_mm": minimum.tolist(),
        "maximum_mm": maximum.tolist(),
        "volume_mm3": properties.Mass(),
        "uniform_density_centroid_mm": [center.X(), center.Y(), center.Z()],
    }


def mesh_model(model):
    mesher = BRepMesh_IncrementalMesh(
        model.shape, MESH_DEFLECTION, False, MESH_ANGLE, True
    )
    mesher.Perform()
    triangles = []
    materials = []
    for face in subshapes(model.shape, TopAbs_FACE):
        location = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation_s(face, location)
        if triangulation is None:
            continue
        transform = location.Transformation()
        nodes = []
        for index in range(1, triangulation.NbNodes() + 1):
            point = triangulation.Node(index).Transformed(transform)
            nodes.append((point.X(), point.Y(), point.Z()))
        nodes = np.asarray(nodes)
        for index in range(1, triangulation.NbTriangles() + 1):
            indices = np.array(triangulation.Triangle(index).Get(), dtype=int) - 1
            if face.Orientation() == TopAbs_REVERSED:
                indices = indices[[0, 2, 1]]
            triangles.append(nodes[indices])
            materials.append(COLORS[model.face_materials[hash(face)]])
    triangles = np.round(np.asarray(triangles), 5)
    materials = np.asarray(materials)
    cross = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    keep = np.linalg.norm(cross, axis=1) > 2e-10
    print("Removed collapsed tessellation triangles:", int(np.sum(~keep)), flush=True)
    return triangles[keep], materials[keep]


def mesh_metrics(triangles):
    vertices, inverse = np.unique(
        np.round(triangles.reshape(-1, 3), 5), axis=0, return_inverse=True
    )
    indices = inverse.reshape(-1, 3)
    edges = np.concatenate([
        indices[:, [0, 1]], indices[:, [1, 2]], indices[:, [2, 0]],
    ])
    sorted_edges = np.sort(edges, axis=1)
    unique_edges, edge_inverse, counts = np.unique(
        sorted_edges, axis=0, return_inverse=True, return_counts=True
    )
    directions = np.where(edges[:, 0] < edges[:, 1], 1, -1)
    signed_counts = np.bincount(edge_inverse, weights=directions)
    parents = np.arange(len(vertices))

    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    for first, second in unique_edges:
        first_root = root(first)
        second_root = root(second)
        if first_root != second_root:
            parents[second_root] = first_root
    components = len({root(index) for index in range(len(vertices))})
    cross = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    triangle_areas = np.linalg.norm(cross, axis=1) / 2
    volume = np.einsum("ij,ij->i", triangles[:, 0], np.cross(triangles[:, 1], triangles[:, 2])).sum() / 6
    return {
        "triangles": len(triangles),
        "welded_vertices": len(vertices),
        "connected_components": components,
        "boundary_edges": int(np.sum(counts == 1)),
        "nonmanifold_edges": int(np.sum(counts > 2)),
        "inconsistently_oriented_edges": int(np.sum(signed_counts != 0)),
        "degenerate_triangles": int(np.sum(triangle_areas < 1e-10)),
        "signed_volume_mm3": float(volume),
        "size_mm": np.ptp(triangles.reshape(-1, 3), axis=0).tolist(),
    }


def write_stl(triangles, destination):
    normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    lengths = np.linalg.norm(normals, axis=1)
    normals /= np.maximum(lengths[:, None], 1e-20)
    record_dtype = np.dtype([
        ("normal", "<f4", (3,)),
        ("vertices", "<f4", (3, 3)),
        ("attribute", "<u2"),
    ])
    records = np.zeros(len(triangles), dtype=record_dtype)
    records["normal"] = normals
    records["vertices"] = triangles
    header = b"Kobo-chan stylized figure; millimetres; one solid; front -Y, vertical +Z"
    with destination.open("wb") as stream:
        stream.write(header.ljust(80, b" "))
        stream.write(struct.pack("<I", len(records)))
        stream.write(records.tobytes())
    # Check the actual float32 coordinates written to the STL, not just the B-rep mesh.
    data = np.frombuffer(destination.read_bytes(), dtype=record_dtype, offset=84)
    return data["vertices"].astype(float)


def write_step(model, destination):
    document = TDocStd_Document(TCollection_ExtendedString("Kobo-chan"))
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())
    color_tool = XCAFDoc_DocumentTool.ColorTool_s(document.Main())
    label = shape_tool.AddShape(model.shape, False)
    TDataStd_Name.Set_s(label, TCollection_ExtendedString("Kobo-chan - stylized display figure (mm)"))
    for face in subshapes(model.shape, TopAbs_FACE):
        face_label = shape_tool.AddSubShape(label, face)
        rgb = COLORS[model.face_materials[hash(face)]]
        color_tool.SetColor(face_label, Quantity_Color(*rgb, Quantity_TOC_RGB), XCAFDoc_ColorSurf)
    writer = STEPCAFControl_Writer()
    writer.SetColorMode(True)
    writer.SetNameMode(True)
    if not writer.Transfer(document, STEPControl_AsIs):
        raise RuntimeError("STEP transfer failed")
    if writer.Write(str(destination)) != IFSelect_RetDone:
        raise RuntimeError("STEP write failed")
    reader = STEPControl_Reader()
    if reader.ReadFile(str(destination)) != IFSelect_RetDone:
        raise RuntimeError("STEP round-trip read failed")
    reader.TransferRoots()
    return shape_metrics(reader.OneShape())


def render_preview(triangles, materials, destination, height):
    import vtk
    from vtk.util.numpy_support import numpy_to_vtk, numpy_to_vtkIdTypeArray
    from PIL import Image, ImageDraw, ImageFont

    vertices, inverse = np.unique(
        np.round(triangles.reshape(-1, 3), 5), axis=0, return_inverse=True
    )
    poly = vtk.vtkPolyData()
    points = vtk.vtkPoints()
    points.SetData(numpy_to_vtk(vertices, deep=True))
    poly.SetPoints(points)
    connectivity = np.column_stack([
        np.full(len(triangles), 3, dtype=np.int64), inverse.reshape(-1, 3),
    ]).astype(np.int64)
    cells = vtk.vtkCellArray()
    cells.ImportLegacyFormat(numpy_to_vtkIdTypeArray(connectivity.ravel(), deep=True))
    poly.SetPolys(cells)
    cell_colors = numpy_to_vtk(np.round(materials * 255).astype(np.uint8), deep=True)
    cell_colors.SetName("Materials")
    poly.GetCellData().SetScalars(cell_colors)
    normals = vtk.vtkPolyDataNormals()
    normals.SetInputData(poly)
    normals.SetFeatureAngle(42)
    normals.SplittingOn()
    normals.ConsistencyOn()
    normals.ComputePointNormalsOn()
    normals.Update()

    window = vtk.vtkRenderWindow()
    window.SetOffScreenRendering(1)
    window.SetSize(1500, 1220)
    window.SetMultiSamples(8)
    for index, camera_direction in enumerate([(0, -1, 0.08), (0.72, -1, 0.27)]):
        renderer = vtk.vtkRenderer()
        renderer.SetViewport(index * 0.5, 0, (index + 1) * 0.5, 1)
        renderer.SetBackground(0.055, 0.085, 0.105)
        renderer.SetBackground2(0.12, 0.18, 0.20)
        renderer.GradientBackgroundOn()
        window.AddRenderer(renderer)
        mapper = vtk.vtkPolyDataMapper()
        mapper.SetInputConnection(normals.GetOutputPort())
        mapper.SetScalarModeToUseCellData()
        actor = vtk.vtkActor()
        actor.SetMapper(mapper)
        actor.GetProperty().SetInterpolationToPhong()
        actor.GetProperty().SetAmbient(0.24)
        actor.GetProperty().SetDiffuse(0.78)
        actor.GetProperty().SetSpecular(0.15)
        actor.GetProperty().SetSpecularPower(32)
        renderer.AddActor(actor)
        camera = renderer.GetActiveCamera()
        target = np.array((0, 0, height * 0.49))
        camera.SetPosition(*(target + np.asarray(camera_direction) * height * 3))
        camera.SetFocalPoint(*target)
        camera.SetViewUp(0, 0, 1)
        camera.ParallelProjectionOn()
        camera.SetParallelScale(height * 0.60)
        renderer.ResetCameraClippingRange()
        renderer.AutomaticLightCreationOff()
        for position, intensity in [((-80, -140, 180), 0.9), ((90, -60, 100), 0.45), ((30, 70, 150), 0.65)]:
            light = vtk.vtkLight()
            light.SetLightTypeToSceneLight()
            light.SetPosition(*(np.asarray(position) * height / 100))
            light.SetFocalPoint(*target)
            light.SetIntensity(intensity)
            renderer.AddLight(light)
    window.Render()
    capture = vtk.vtkWindowToImageFilter()
    capture.SetInput(window)
    capture.SetInputBufferTypeToRGB()
    capture.ReadFrontBufferOff()
    capture.Update()
    from vtk.util.numpy_support import vtk_to_numpy
    pixels = vtk_to_numpy(capture.GetOutput().GetPointData().GetScalars())
    preview = Image.fromarray(np.flipud(pixels.reshape(1220, 1500, 3)))
    window.Finalize()
    draw = ImageDraw.Draw(preview)
    try:
        title_font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 34)
        body_font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 20)
    except OSError:
        title_font = ImageFont.load_default()
        body_font = title_font
    draw.text((48, 28), "KOBO-CHAN", fill=(239, 244, 233), font=title_font)
    draw.text((48, 77), f"Form 3 geometry revision  /  {height:g} mm overall  /  Supports required", fill=(182, 206, 202), font=body_font)
    draw.text((48, 1170), "FRONT", fill=(182, 206, 202), font=body_font)
    draw.text((798, 1170), "THREE-QUARTER", fill=(182, 206, 202), font=body_font)
    preview.save(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--height", type=float, default=100.0)
    parser.add_argument("--no-render", action="store_true")
    arguments = parser.parse_args()
    if arguments.height <= 0:
        parser.error("Height must be positive")
    folder = Path(__file__).resolve().parent
    model = build_figure()
    if arguments.height != REFERENCE_HEIGHT:
        model.scale(arguments.height / REFERENCE_HEIGHT)
    original = shape_metrics(model.shape)
    print("B-REP:", json.dumps(original), flush=True)
    if not original["valid_brep"] or original["solid_count"] != 1:
        raise RuntimeError("The figurine must be one valid connected solid")
    if abs(original["size_mm"][2] - arguments.height) > 0.01:
        raise RuntimeError("Overall height is not the requested value")

    # Reversible parameter check in memory: no separate CAD document is created.
    model.scale(1.2)
    enlarged = shape_metrics(model.shape)
    assert enlarged["valid_brep"] and enlarged["solid_count"] == 1
    assert np.allclose(enlarged["size_mm"], np.asarray(original["size_mm"]) * 1.2, atol=0.002)
    assert np.isclose(enlarged["volume_mm3"], original["volume_mm3"] * 1.2 ** 3, rtol=1e-5)
    model.scale(1 / 1.2)
    restored = shape_metrics(model.shape)
    assert restored["valid_brep"] and restored["solid_count"] == 1
    assert np.allclose(original["size_mm"], restored["size_mm"], atol=0.002)
    print("Height parameter check: 120% and restored; passed", flush=True)

    export_name = f"kobochan_form3_{arguments.height:g}mm"
    step_path = folder / f"{export_name}.step"
    round_trip = write_step(model, step_path)
    print("STEP ROUND TRIP:", json.dumps(round_trip), flush=True)
    assert round_trip["valid_brep"] and round_trip["solid_count"] == 1
    volume_matches = np.isclose(round_trip["volume_mm3"], restored["volume_mm3"], rtol=1e-5)
    print("STEP volume matches:", volume_matches, flush=True)
    assert np.allclose(round_trip["size_mm"], restored["size_mm"], atol=0.002)
    triangles, materials = mesh_model(model)
    exported_triangles = write_stl(triangles, folder / f"{export_name}.stl")
    checks = mesh_metrics(exported_triangles)
    print("STL:", json.dumps(checks), flush=True)
    if not arguments.no_render:
        render_preview(triangles, materials, folder / "kobochan_form3_preview.png", arguments.height)
    assert checks["boundary_edges"] == 0
    assert checks["nonmanifold_edges"] == 0
    assert checks["inconsistently_oriented_edges"] == 0
    assert checks["degenerate_triangles"] == 0
    assert checks["connected_components"] == 1
    assert checks["signed_volume_mm3"] > 0
    assert np.isclose(checks["signed_volume_mm3"], restored["volume_mm3"], rtol=0.004)
    assert abs(checks["size_mm"][2] - arguments.height) < 0.002
    assert volume_matches
    assert restored["shell_count"] == 1
    assert np.all(np.asarray(restored["size_mm"]) < FORM3_BUILD_VOLUME)

    # Tilt backward about X so the front/face points somewhat upward, leaving
    # the back and underside as preferred support-contact regions. No supports
    # or raft are generated by this script; these must be reviewed in PreForm.
    angle = math.radians(FORM3_TILT_DEGREES)
    rotation = np.array([
        [1, 0, 0],
        [0, math.cos(angle), -math.sin(angle)],
        [0, math.sin(angle), math.cos(angle)],
    ])
    tilted = triangles @ rotation.T
    minimum = tilted.reshape(-1, 3).min(axis=0)
    maximum = tilted.reshape(-1, 3).max(axis=0)
    translation = -(minimum + maximum) / 2
    translation[2] = -minimum[2]
    tilted += translation
    tilted_export = write_stl(tilted, folder / f"{export_name}_tilt25_unsupported.stl")
    tilted_checks = mesh_metrics(tilted_export)
    print("FORM 3 ORIENTATION:", json.dumps(tilted_checks), flush=True)
    assert tilted_checks["connected_components"] == 1
    for check in ("boundary_edges", "nonmanifold_edges", "inconsistently_oriented_edges", "degenerate_triangles"):
        assert tilted_checks[check] == 0
    assert np.all(np.asarray(tilted_checks["size_mm"]) < FORM3_BUILD_VOLUME)
    assert np.isclose(tilted_checks["signed_volume_mm3"], checks["signed_volume_mm3"], rtol=1e-6)

    report = {
        "printer": "Formlabs Form 3",
        "resin_planning_assumption": "Standard Grey Resin V4 / V4.1; actual resin not specified",
        "overall_height_mm": arguments.height,
        "crown_tip_diameter_mm": 2 * CROWN_TIP_RADIUS * arguments.height / REFERENCE_HEIGHT,
        "crown_root_diameter_mm": 2 * CROWN_BASE_RADIUS * arguments.height / REFERENCE_HEIGHT,
        "build_volume_mm": FORM3_BUILD_VOLUME.tolist(),
        "brep": restored,
        "step_round_trip": round_trip,
        "upright_stl": checks,
        "tilted_stl": tilted_checks,
        "tilt_about_x_degrees": FORM3_TILT_DEGREES,
        "uniform_scale_parameter_test": "120 percent scale, checked and restored",
        "enclosed_hollow_resin_cavities": False,
        "supports_generated": False,
        "preform_job_generated": False,
        "preform_support_and_layer_checks_completed": False,
        "physical_print_test_completed": False,
        "status": "Geometrically checked; PreForm support/resin setup and test print still required",
    }
    (folder / "form3_validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("Exports complete", flush=True)


if __name__ == "__main__":
    main()
