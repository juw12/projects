"""Re-import a STEP file and report solid / bbox / volume diagnostics.

``cadquery`` is imported lazily inside :func:`validate_step` so the module
itself (and therefore ``server.py``) can be loaded on a Python without
``cadquery`` installed. The validator returns the dict described in
``docs/photo2cad-spec.md``:

    {
      "valid": bool,             # exactly 1 solid AND non-empty bbox
      "solids": int,             # number of distinct TopoDS_Solid
      "bbox_mm": [x, y, z],      # axis-aligned bbox in mm (or all-zero)
      "volume_mm3": float|None,  # None when cadquery cannot compute it
      "warnings": [str, ...],
    }

A missing / failed volume computation is recorded as a warning only — it
never downgrades ``valid`` from True to False (the spec is explicit on
this).
"""
from __future__ import annotations

import os
from typing import Any


def validate_step(step_path: str) -> dict:
    """Re-import ``step_path`` and inspect the resulting shape."""
    result: dict[str, Any] = {
        "valid": False,
        "solids": 0,
        "bbox_mm": [0.0, 0.0, 0.0],
        "volume_mm3": None,
        "warnings": [],
    }
    if not step_path or not os.path.isfile(step_path):
        result["warnings"].append("step file does not exist: %r" % (step_path or ""))
        return result

    try:
        import cadquery as cq  # noqa: F401  - lazy
    except Exception as exc:  # pragma: no cover - missing dep path
        result["warnings"].append("cadquery import failed: %s" % exc)
        return result

    # Import the STEP. ``importStep`` returns a ``cq.Workplane``.
    try:
        workplane = cq.importers.importStep(step_path)
    except Exception as exc:
        result["warnings"].append("importStep failed: %s" % exc)
        return result

    # Flatten into the underlying ``cq.Shape`` / ``OCP.TopoDS.TopoDS_Shape``.
    try:
        compound = workplane.val()
    except Exception as exc:
        result["warnings"].append("could not access workplane.val(): %s" % exc)
        return result

    # ---- Solid count -------------------------------------------------------
    # In cadquery 2.x ``Shape.Solids()`` returns a Python list of
    # ``cq.Solid`` objects; in older versions it returned a
    # ``TopExp_Explorer`` with ``More()``/``Next()``. Support both.
    solids_count = 0
    try:
        solids = compound.Solids()
        if hasattr(solids, "More") and hasattr(solids, "Next"):
            try:
                while solids.More():
                    solids.Next()
                    solids_count += 1
            except Exception:
                solids_count = 0
        else:
            try:
                solids_count = len(list(solids))
            except TypeError:
                solids_count = sum(1 for _ in solids)
    except Exception as exc:
        result["warnings"].append("solid count failed: %s" % exc)
        solids_count = 0
    result["solids"] = int(solids_count)

    # ---- Bounding box ------------------------------------------------------
    try:
        bb = compound.BoundingBox()
        x = float(getattr(bb, "xlen", 0.0))
        y = float(getattr(bb, "ylen", 0.0))
        z = float(getattr(bb, "zlen", 0.0))
        result["bbox_mm"] = [round(x, 6), round(y, 6), round(z, 6)]
    except Exception as exc:
        result["warnings"].append("bbox failed: %s" % exc)
        result["bbox_mm"] = [0.0, 0.0, 0.0]

    # ---- Volume (warning only) --------------------------------------------
    try:
        vol = float(compound.Volume())
        result["volume_mm3"] = round(vol, 6)
    except Exception as exc:
        result["warnings"].append("volume unavailable: %s" % exc)
        result["volume_mm3"] = None

    # ---- Validity ---------------------------------------------------------
    bbox = result["bbox_mm"]
    bbox_nonempty = any(v > 0.0 for v in bbox)
    result["valid"] = (solids_count == 1) and bbox_nonempty

    return result


__all__ = ["validate_step"]
