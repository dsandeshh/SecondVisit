# SecondVisit: every API and resource we use

Source of truth for the sponsor data: the CoStar track quickstart at
https://beta-app.matterport.com/2026-princeton-hackathon/quickstart and its `AGENTS.md`
(both read on Sat 14 Nov, 20:25). Download the quickstart files into `vendor/matterport/` before
building: `matterport_quickstart.py`, `matterport_quickstart.ipynb`, `models_index.csv`, `AGENTS.md`,
`basemap.json`. Their links are on the quickstart page (Notebook, Script, models_index.csv); the files
live under `https://static.matterport.com/hackathon/26.15.39-main-39-gef8d668/assets/quickstart/`.
`matterport_quickstart.py` is the working reference for every Matterport, Vexcel and CoStar call below:
reuse its helpers (`graph()`, `HttpFile` range reader, `near()`, `equirect()`) instead of rewriting them.

## 0. Keys: where to get each one

| Env var | What | Where |
|---|---|---|
| `MATTERPORT_API_KEY` | Matterport "API key" (user name half) | Track Discord, run `/costar-keys` |
| `MATTERPORT_API_TOKEN` | Matterport "API token" (secret half) | same card |
| `VEXCEL_API_KEY` | Vexcel api_key | Vexcel keys card in the track Discord |
| `COSTAR_KIT_ZIP` | Path to the local CoStar kit zip (about 50 MB), e.g. `data/costar/costar_kit.zip` (gitignored) | Download once from the CoStar keys card link |
| `COSTAR_KIT_URL` | Optional. The kit's download link, only needed to fetch the zip again | CoStar keys card |
| `COSTAR_API_KEY` | Optional. Not used by the kit; reserved in case the sponsor offers a live CoStar API | CoStar keys card, if offered |
| `COSTAR_ZIP_PASSWORD` | CoStar kit zip password | CoStar keys card |
| `ANTHROPIC_API_KEY` | Claude API, used by the deep agents and vision labelling | your Anthropic console, or hackathon credits if offered |
| `DR_MODEL` | Orchestrator model id, e.g. `claude-sonnet-5-5` | set yourself |
| `DR_FAST_MODEL` | Subagent and vision model id, e.g. `claude-haiku-5-5` (use sonnet for vision if labels are weak) | set yourself |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` | Agent traces with a shareable link | smith.langchain.com, free tier |
| `MATTERPORT_SDK_KEY` | Optional. Showcase SDK application key for scripting the embedded 3D tour | Ask the CoStar mentors (Ted Weidling for the API); a plain iframe embed needs no key |

All keys live in a git ignored `.env`. Never print, log or commit them. Everyone at the event shares the
sponsor keys: keep requests well under 10 per second and cache everything to `data/raw/`.

Mentors: #costar-group on Discord or `/ask-costar`. Ted Weidling (the API), Azwad Sabik, Ilia Glazkov,
Lucas Hayne (semantic search), Olaf Brandt, Guillermo Bruce (Discord).

## 1. Matterport Model API (GraphQL)

- Endpoint: `POST https://api.matterport.com/api/models/graph`, JSON body `{"query": ..., "variables": ...}`.
- Auth: HTTP basic, user = `MATTERPORT_API_KEY`, password = `MATTERPORT_API_TOKEN`. Production only;
  any other host answers 403 `invalid key/secret`. An unseen model answers a GraphQL error with code `not.found`.
- Null fields are omitted, so read with `.get()`. Paging ends when `nextOffset` is missing.
- Signed URLs (`?t=...`) expire (about an hour). Re query instead of caching URLs; cache the downloaded bytes.
- Units: metres. Frame: Matterport model frame, x and y horizontal, z up. **We use this frame directly as
  our plan frame** (x right, y up), so `frames.plan_from_matterport` is the identity.
- Playground: the Model Playground (GraphiQL with your key) on the hackathon site. Use it to check field
  shapes before coding.

### 1.1 Key check
```graphql
{ rootFolder { name modelCountSummary(includeModelsInSubfolders: true)
  subfolders { results { id name modelCountSummary(includeModelsInSubfolders: true) } } } }
```
Expect "HackPrinceton 2026", 14,945 models (Commercial 13,014, Residential 1,930).

### 1.2 Model basics (resolver, map date, Showcase link)
```graphql
query Basics($id: ID!) { model(id: $id) {
  id name description created visibility
  address { address locality administrativeArea postalCode }
  geolocation { lat long }
  generatedDescription { summary }
  propertyClassifications { classification type }
  floors { id label } rooms { id } panoLocations { id }
  image { url } } }
```
`created` is the copy date (9 to 11 Nov 2026). Use `original_created` from `models_index.csv` as the map date.

### 1.3 Walls, rooms, floor plans (the occupancy grid comes from this)
```graphql
query Rooms($id: ID!) { model(id: $id) {
  floors { id label sequence vertices { id position { x y } }
           edges { id type thickness vertices { id } } }
  rooms { id floor { id } classifications { label confidence } boundary { edges { id } }
          dimensions(units: metric) { areaFloor width depth height } }
  assets { floorplans(provider: "matterport") { format flags url width height resolution origin { x y } } }
  panoLocations { id label position { x y z } } } }
```
- Walls: each edge joins two vertices and has `thickness` (m). The sample model only shows
  `type: "wall"`; check in the Playground whether door or opening types exist. If not, doors are
  found as gaps (see plan Task 2).
- Rooms: `classifications[0].label` (e.g. Living Room, Hallway, Bathroom; "Void" means not a room),
  boundary is a loop of edge ids, `dimensions` gives area, width, depth, height.
- Floor plan images: `origin` is the image's bottom left corner in metres, `resolution` is pixels per
  metre. Use the `photogramy` jpg as the observer background and for the printed reality check plan.
  A schematic DXF is also listed.

### 1.4 Panoramas and the defurnished view (landmarks and fixed vs movable)
```graphql
query Panos($id: ID!) { model(id: $id) {
  panoLocations { id label position { x y z } skybox(resolution: "2k") { status children } }
  view(type: "matterport.model.defurnished") { id } } }
```
- Six signed face URLs per pano in order: 0 up, 1 to 4 around the horizon, 5 down. `"4k"` also works.
- Defurnished: query `model(id: <view id>)` with the same fields. Pano ids are the same. 6,979 models
  have one (`defurnished` column in the index).
- Mattertags are empty on the models the sponsor checked: do not plan on them.

### 1.5 MatterPak: OBJ mesh and point cloud (furniture obstacles, 3D label placement)
```graphql
query MatterPak($id: ID!) { model(id: $id) {
  bundle(id: "mp:matterpak") { availability assets { ... on Resource { format status filename url } } } } }
```
- Use the bundle. `assets { resources(format: "matterpak") }` says unavailable for hackathon keys.
- The zip holds `cloud.xyz` (ASCII `x y z r g b`, metres, z up, same frame as panos and walls),
  `<uuid>.obj` plus textures, and plan renders. Read single members with HTTP range requests
  (`HttpFile` in the quickstart) and keep every 10th point.
- A model whose MatterPak is not ready has no `url`.

### 1.6 Showcase (3D tour) for sighted judges
- Plain embed, no key: `<iframe src="https://my.matterport.com/show/?m=<sid>&play=1&qs=1">` for
  public or unlisted models (`visibility` in 1.2).
- Scripted (move the camera with the traveller): Showcase SDK with `MATTERPORT_SDK_KEY`, allowlisted
  domains. Docs: https://matterport.github.io/developer-docs/overview/ . P2 only.

### 1.7 Not available
Geographic search (use `models_index.csv`), E57, raw scans, Mattertags (empty). No JRR or Princeton
model. Splats and drone photos exist for 232 mostly residential models; we do not use them.

## 2. models_index.csv (our search index and the join key between layers)

14,945 rows. Columns: `sid, name, segment, lat, lon, latlon_source, address, city, state, postal_code,
internal_id, costar_property_id, homes_listing_id, splat, drone_photos, pano_count, room_count,
floor_count, created, original_created, defurnished, ai_summary`.

- Name or address to model: fuzzy match on `name` and `address` (the resolver, plan Task 14).
- Geo search: plain distance filter on `lat`, `lon` (`near()` in the quickstart).
- Join to CoStar: commercial rows via `costar_property_id` (6,191 rows have one); residential via
  `homes_listing_id`. `internal_id` prefixes `Apartments-` and `Loopnet-` are other listing systems.

**Demo building candidates found in the index (verify each in Task 0):**

| sid | name | city | panos | rooms | CoStar id | role |
|---|---|---|---|---|---|---|
| `x37LjPx62VA` | Medical Office | Houston | 20 | 21 | 5615020 | **Primary demo clinic** |
| `1uXpcwty9Sr` | Brentwood Medical Plaza, Suite 106 | Los Angeles | 41 | 4 | none | Backup clinic |
| `THASDAsdrw3` | Suite 106 | Houston | 29 | 35 | 350372 | Backup with CoStar id |
| `ceedN1poehu` | CKD Physician Office | none | 2 | 1 | none | Too small, skip |

For the portfolio ranking (plan Task 20), take commercial rows with `lat`, a `costar_property_id`,
`room_count >= 5`, and a name or classification suggesting office or medical use.

## 3. Vexcel (aerial imagery outside the building)

- Base: `https://api.vexcelgroup.com/v2/...`, header `X-API-KEY: $VEXCEL_API_KEY`.
- Coverage for hackathon keys: Houston and Los Angeles only. Anywhere else answers 403.
- Ortho clip (7.5 cm per pixel) around a point:
```http
POST https://api.vexcelgroup.com/v2/ortho/extract
X-API-KEY: <key>
{"wkt": "POLYGON((lon1 lat1, lon2 lat1, lon2 lat2, lon1 lat2, lon1 lat1))", "srid": 4326,
 "layer": "urban,urban-r,wide-area,urban-g", "crop": "bounding_box",
 "image-format": "jpeg", "destination-dimensions": "1400,1400", "attribution": "false"}
```
  Note WKT is lon lat order. Returns `image/jpeg`.
- Obliques, parcels, roof attributes, object detection and embedding search: Vexcel's own tutorial and
  Python quickstart, linked from the Vexcel keys card in Discord. We want: an oblique of the building
  front (to see the entrance), the parcel or footprint (to pick the entrance side), and the curb.
  Ask the Vexcel mentor for the exact oblique call if the tutorial is unclear.

## 4. CoStar kit (property and listing records)

The kit is **local**: one password protected zip at `COSTAR_KIT_ZIP` (a path, default
`data/costar/costar_kit.zip`, gitignored with all of `data/costar/`), password `COSTAR_ZIP_PASSWORD`.
`COSTAR_KIT_URL` is optional and only used to download it again. The zip uses classic ZipCrypto, so
Python's `zipfile` reads members directly with `setpassword()`; stream the JSONL members line by line
instead of extracting them. Nothing read from the kit, or derived from it, goes into git or a public link
(CLAUDE.md rule 9). Checked Sat 14 Nov against the real password: the join works.

**What the zip holds**
- `index.md`; `models/` (one Markdown field reference per data model); `schemas/` (a JSON Schema per
  model, `openapi.yaml`, `enums.json` with 161 code tables); `concepts/` (12 short explainers: glossary,
  tenants and occupancy, listings and leasing, property types and measurement, and so on);
  `tools/expand_records.py`.
- 8 data JSONL files under `data/`: `commercial-property` (3,339 records, 193 MB), `location-occupancy`
  (74,093 tenancies), `company-detail`, `commercial-listing-summary`, `commercial-sale-comp`,
  `apartment-listing`, `residential-listings`, `residential-listing-features`.
- `commercial-properties.csv` (13,147 rows): `PropertyId, MatterportModelId, Address, City, State`. This
  is the join from a Matterport model to a CoStar property. One property can have several models
  (5615020 has two).
- `residential-listings.csv`: residential listings, joined on `homes_listing_id` from `models_index.csv`.

**`data/commercial-property.jsonl` keys.** Each record has 39 top level keys, because null fields are left
out, but the set differs between records: 52 distinct keys across the file. Always present (28): `id`,
`addresses`, `primaryAddress`, `propertyType`, `propertySubtype`, `isCondo`, `buildingClass`,
`buildingRating`, `buildingRatingType`, `constructionStatus`, `coStarBuildingType`, `constructionEvents`,
`buildingConstructionMaterial`, `sprinklerType`, `lotSizeMeasurementType`, `parcelNumbers`,
`parcelReferences`, `parking`, `primarySubmarketId`, `primaryPhoto`, `attachments`, `amenities`,
`renovations`, `aliases`, `propertyGroupSubtype`, `notes`, `contacts`, `floors`. Sometimes present (24):
`grossBuildingAreaSquareFeet`, `environmental`, `numStoriesAboveGrade`, `lotSize`,
`grossTypicalFloorSquareFeet`, `propertyApartment`, `buildingName`, `parkingRatio`, `zoningDescription`,
`propertyWebsiteUrl`, `zoningLongDescription`, `hasSprinklers`, `rentableBuildingAreaSquareFeet`,
`lotWidthInFeet`, `lotLengthInFeet`, `buildingHeightInFeet`, `propertyOffice`, `buildingPark`,
`propertyGroupId`, `propertyIndustrial`, `propertyRetail`, `propertyHospitality`, `propertyFlex`, `land`.
Codes (`propertyType`, `buildingClass`, `parkingType`, ...) decode through `schemas/enums.json`.

**Fields useful to us** (from `schemas/` and `concepts/`; the kit has no ADA or accessibility field)

| Need | Field | Notes |
|---|---|---|
| Building use | `propertyType`, `propertySubtype` (enums `PropertyType`, `PropertySubtype`) | Healthcare is type 13; `Office_Medical` is a subtype. Per space: `spaceUse` (`OfficeMedical` 2, `Medical` 4) on listing spaces |
| Tenants | `location-occupancy`: `propertyId`, `tenantLocationId`, `fromDate`, `toDate` (null = current), `moveInDate`, `addressId`, `spaces[]` | Name and industry from `company-detail` (`name`, `profile.industryType`; use the profile's industry, not the occupancy's) |
| Suites | `spaces[]` on occupancies (`propertyFloorId`, `squareFeetOccupied`, `buildOut`, `spaceLayout`); listing spaces have `suite`, `floorName`, `spaceUse` | `buildOut` 21 = StandardMedical. Suite numbers are often missing |
| Single or multi tenant | `propertyOffice.tenancyType` / `propertyRetail.tenancyType` | 1 single, 2 multi |
| Floors and lifts | `numStoriesAboveGrade`, `floors[]`; `propertyX.structural.elevators[]` (`elevatorType`, `elevatorState` 1 exists, 2 does not) | Step free routing claims need these |
| Arrival | `propertyRetail.frontage[]`: `streetName`, `frontageInFeet`, `numCurbCuts`, `isPrimaryFrontage` (side with the main entrance), `footprint.shape` (LineString, lon lat) | Cross checks the Vexcel door and curb pins (Task 15) |
| Parking | `parking[]` (`parkingType`: 1 surface, 3 covered; `totalSpaces`), `parkingRatio` | Handicap parking exists only as a residential parking type |
| Amenities | `amenities[]` (ids) | The kit does not include amenity names |

**Demo building, property 5615020.** The record, its tenancies and the second model are summarised in
`data/x37LjPx62VA/raw/costar_5615020_notes.md` (gitignored, local only). Do not copy record values into
committed files.

## 5. Claude API and LangChain Deep Agents

- `pip install "deepagents>=0.7.38,<0.8"` (pulls in langchain-anthropic; Python 3.11+).
- `create_deep_agent(model, tools, *, system_prompt, middleware, subagents, interrupt_on, checkpointer, ...)`.
  Model as `"anthropic:<DR_MODEL>"` or a `ChatAnthropic` instance.
- `write_todos` is off by default since 0.7.0: pass `middleware=[TodoListMiddleware()]`.
- Subagents: dicts with `name`, `description`, optional `system_prompt`, `tools`, `model`, `middleware`.
  The virtual filesystem (`ls`, `read_file`, `write_file`, `edit_file`) is shared with subagents.
- Human in the loop: LangGraph `interrupt()` inside a tool plus a checkpointer; resume with `Command(resume=...)`.
- Streaming for the trace panel: `astream(stream_mode=["updates","custom"], subgraphs=True)`.
- Vision: send skybox faces as base64 image blocks to `DR_FAST_MODEL` through `ChatAnthropic`.
- LangSmith: `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`; share a trace from the UI.
- Details and a tested skeleton: `review/agent1_langchain.md`, `review/langchain/`.
- Amazon Practical AI track: ask the Amazon rep whether AWS (for example Bedrock) is required. If it is,
  only `DR_MODEL` and `DR_FAST_MODEL` change; nothing else in the code should know the provider.

## 6. Browser APIs used by the rehearsal app

Web Audio (AudioContext, ConvolverNode, PannerNode with HRTF), Web Speech (speechSynthesis),
DeviceOrientationEvent (permission tap on iOS, HTTPS), navigator.vibrate (Android only),
navigator.audioSession (iOS 17+), Wake Lock, BroadcastChannel and WebSocket (observer view).
Pitfalls and fixes: `review/agent3_experience.md` sections 1 and 2.

## 7. Quick checks (run before building anything)

```bash
# Matterport key check (prints folder counts)
curl -s -u "$MATTERPORT_API_KEY:$MATTERPORT_API_TOKEN" -H 'Content-Type: application/json' \
  https://api.matterport.com/api/models/graph \
  -d '{"query":"{ rootFolder { name modelCountSummary(includeModelsInSubfolders: true) } }"}'

# Does the demo clinic have walls, rooms, a defurnished view and a MatterPak?
curl -s -u "$MATTERPORT_API_KEY:$MATTERPORT_API_TOKEN" -H 'Content-Type: application/json' \
  https://api.matterport.com/api/models/graph \
  -d '{"query":"query($id:ID!){model(id:$id){name visibility floors{label edges{type}} rooms{classifications{label}} view(type:\"matterport.model.defurnished\"){id} bundle(id:\"mp:matterpak\"){availability}}}","variables":{"id":"x37LjPx62VA"}}'

# Vexcel ortho around the clinic (fill the polygon from the model's lat/lon, about 60 m square)
curl -s -X POST https://api.vexcelgroup.com/v2/ortho/extract -H "X-API-KEY: $VEXCEL_API_KEY" \
  -H 'Content-Type: application/json' -o clinic_ortho.jpg -d '{"wkt":"POLYGON((...))","srid":4326,"layer":"urban,urban-r,wide-area,urban-g","crop":"bounding_box","image-format":"jpeg","destination-dimensions":"1400,1400"}'
```
