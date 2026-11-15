# Data status (Task 0)

Pulled Sat 14 Nov 2026, about 21:40, with `python -m dr.probe pull --model x37LjPx62VA` (178 MB, cached
in `data/x37LjPx62VA/raw/`, gitignored). Re run `python -m dr.probe status --model <sid>` for this table.
Sponsor values (CoStar fields, tenants, addresses) are deliberately not copied here: see the gitignored
`data/x37LjPx62VA/raw/costar.json` and `costar_5615020_notes.md`.

## Clinic `x37LjPx62VA` ("Medical Office")

| Layer | Status | Detail |
|---|---|---|
| Walls | OK | 139 edges on 1 floor, every edge `type: "wall"` (no door or opening types) |
| Rooms | partial | 21 rooms: 17 "Other", 4 "Void". Polygons and areas fine; names come from the annotator (Task 3) |
| Panoramas | OK | 20 of 20 with 2k skyboxes; 80 horizon faces cached (2048 x 2048) |
| Defurnished view | missing | The model has none (`view` answers `not.found`). Task 3 `fixed_check` uses kind plus the model's built in judgement |
| Floor plan | OK | `photogramy` jpg, 4366 x 1532 px, 100 px per metre, origin (-30.82, -12.98) m |
| MatterPak | OK | `unlocked`; point cloud sample cached (1,659,651 points, every 10th) |
| Vexcel ortho | OK | 60 m square around the model's lat/lon, 1400 x 1400 jpeg |
| CoStar | OK | Property record found through the local kit; tenancies and tenant names cached |
| Visibility | OK | public (plain Showcase iframe works without a key) |

**Edge types (Step 2):** only `wall`. Task 2 finds doors as gaps and carves missing ones with
`ensure_doors`; nothing is skipped as a door edge.

**Decision (Step 5):** walls 139 (needs 10 or more), non Void rooms 17 (needs 5), panos with skyboxes 20
of 20, public. All pass, so no backup was pulled.

**Caveat for the pitch:** the scan is from May 2024. Read the CoStar tenancy dates in the gitignored notes
before any copy says the clinic is operating today.

**Human step still open (Step 5):** open https://my.matterport.com/show/?m=x37LjPx62VA and note where the
street entrance and the reception desk are, for `data/x37LjPx62VA/overrides.json` (use `pick.html` once
Task 3 builds it).

## Second model on the same CoStar property: `hpGRjK5uFPW` ("Office B")

Matterport only, from `data/hpGRjK5uFPW/raw/compare_basics.json`:

| | Clinic `x37LjPx62VA` | Office B `hpGRjK5uFPW` |
|---|---|---|
| Visibility | public | public |
| Floors | 1 | 1 |
| Rooms | 21 (17 Other, 4 Void), 348 m² non Void | 4 (3 Other, 1 Void), 457 m² non Void |
| Wall edges | 139, all `wall` | 38, all `wall` |
| Panos | 20 | 5 |
| Defurnished view | no | no |
| MatterPak | unlocked | unlocked |
| Scan date (`original_created`) | 2024-05-24 | 2024-05-24 |
| Matterport classification | healthcare | workspace |
| Distance between model geolocations | 24 m | |

**Verdict:** another suite in the same single storey storefront building, scanned the same day. It is not
a lobby or common area (an open plan space with its own offices and restroom, no shared corridor), and not
a rescan (different size, layout and room count). It cannot extend the route from the building entrance to
the clinic: it is a separate scan with its own model frame, nothing places the two frames together, and in
a storefront building each suite opens to the outside, so the curb to clinic door leg is outdoors and is
covered by the Vexcel arrival (Task 15). It is useful as a second suite in the portfolio (Task 20).

DEMO_SID=x37LjPx62VA
