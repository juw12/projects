# CADScore 1.1.0 refinement results

The refinement addresses the most consequential 1.0 failures: generating credible geometry on the wrong face, orienting a row along the wrong axis, and substituting a single bore for an explicit hole pattern. The scorer itself is unchanged. All counts below use the full prompt set and keep no-output attempts in the denominator.

| Set and version | Mode | Pass | Wrong geometry | Invalid mesh | No output |
|---|---|---:|---:|---:|---:|
| Original 16, v1.0 | Rules | 10 | 1 | 0 | 5 |
| Original 16, v1.1 | Rules | 12 | 0 | 0 | 4 |
| Original 16, v1.0 | Encoder | 8 | 3 | 0 | 5 |
| Original 16, v1.1 | Encoder + explicit-noun safeguards | 12 | 0 | 0 | 4 |
| Fresh 8, v1.1 | Rules | 8 | 0 | 0 | 0 |
| Fresh 8, v1.1 | Encoder + explicit-noun safeguards | 8 | 0 | 0 | 0 |

The original set is a **regression replay**, not new evidence of generalisation. The eight new cases check: underside entry; negation of an underside or Y instruction; a flat-bottom pocket that still opens from the top; a four-bore Y row; a non-centred two-bore Y row; a single-bore control; and an offset underside pocket. Independent references and machined-material checks certify only the enumerated requirements on those meshes. The fresh cases exercise explicit feature cues, so the results do not imply a better pretrained encoder.

Eight rejection scenarios confirm that specified conflicts or unsupported operations produce no guessed geometry: contradictory entry faces, self-negation, side-face pocketing, simultaneous X and Y, a Z-directed pattern, a diagonal pattern, overlapping bores, and a mixed pocket-plus-bore request. Additional CLI tests cover non-overwrite, no residue on refusal, and material occupancy on the correct face of a generated STL.

Still unsupported on the historical prompts: drill-bit wording, deriving pocket depth from remaining floor thickness, coordinate-list patterns, and stock dimensions supplied only as named length/width/thickness. The generator returned no file in these four cases. There was no hardware, manufacturing or independent-user validation.

**Installed-package verification:** all 17 regression tests passed. The installed generation CLI wrote a four-bore Y-pattern STL, and the installed scoring CLI accepted it against the independently built N04 reference and spec.
