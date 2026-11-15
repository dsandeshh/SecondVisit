# Changelog

Contract and plan changes, newest first. Rule 2 in CLAUDE.md: any change to BuildingPackage, RunLog,
RunPlan or PointResult is logged here in the same commit as the code.

## 2026-11-14 (Sat, about 21:45): Task 0 pull

- APIS 1.3 rooms query: removed `panoLocations { floor { id } }`. The API rejects it
  (`FieldUndefined`); the quickstart's own rooms query does not ask for it either.
- `docs/DATA_STATUS.md` written: `DEMO_SID=x37LjPx62VA`, every layer present except the defurnished view.

## 2026-11-14 (Sat, about 21:15): plan v3.1, from the key checks

What the key checks found: the clinic `x37LjPx62VA` has 139 wall edges (all type `wall`), 21 rooms
labelled only "Other" (17) and "Void" (4), 20 panos, **no defurnished view**, MatterPak unlocked. The
CoStar kit is a local zip and the join to property 5615020 works. A second model, `hpGRjK5uFPW`
("Office B"), maps to the same property.

- **CoStar kit is local.** `COSTAR_KIT_ZIP` (path) is the main variable; `COSTAR_KIT_URL` and
  `COSTAR_API_KEY` are optional. CLAUDE.md rule 9, `.env.example`, APIS section 0 and section 4 updated.
  APIS section 4 now lists the kit's contents, the 52 keys of `commercial-property.jsonl` (39 per record),
  and the fields useful to us (use, tenants, suites, floors and lifts, frontage, parking). Record values
  for 5615020 stay in a gitignored notes file under `data/x37LjPx62VA/raw/`. Task 0 Step 6 reads the local zip instead of range requests.
- **Room labelling (Task 3).** The annotator names each non Void room (reception, waiting, exam, office,
  restroom, corridor, storage, other) from its panoramas. Code assigns panos to rooms by polygon
  (`pano_room`), the model only names the room, `merge_room_labels` takes the majority per room with ties
  to the higher confidence. Written to `Room.label` with `prov["room:<id>.label"]` (src `ai`). New tests
  `test_pano_room`, `test_room_label_majority`. No contract change: `Room.label` and `prov` already exist.
- **fixed_check without a defurnished view (Task 3).** Use the defurnished view if the model has one;
  otherwise fixed by kind (desk, door, glass_door, elevator, stairs, restroom, pillar, water; counter maps
  to desk) and movable for seating, other and sign unless most observations say `built_in`. The vision
  prompt and `parse_vision` gain `room` and `built_in`. `test_fixed_check` and
  `test_parse_vision_tolerant` extended. Prov key `landmark:<id>.fixed` documented in the v2 additions.
- **Sponsor data never in git.** `.gitignore` covers `data/costar/`, `data/*/raw/`, the index and basemap,
  built packages except the fixture, `portfolio.json`, `traces/` and mesh and archive files. CLAUDE.md
  rule 9 says sponsor data and anything derived from it never goes into git, a public demo or a public
  link. The Showcase SDK runs on localhost only (note under Commands).
- DESIGN.md data table: room labels come from the annotator; defurnished view only when present.
