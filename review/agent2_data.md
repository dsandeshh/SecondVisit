# SecondVisit: data pipeline risk review (agent 2)

Written Saturday 14 Nov 2026, about 20:00 ET, roughly 12 hours before submission. Scope: what Matterport, Vexcel and CoStar really give us, what breaks tonight, and the demo data strategy that scores best on the CoStar rubric (30% data use, 30% agent depth, 25% usefulness, 15% demo) without lying to judges.

Status tags used below: **[VERIFIED]** read in official docs (URL given), **[INFERRED]** follows from the docs but not stated, **[UNKNOWN]** must be probed tonight.

---

## 0. Bottom line

1. The spec over promises two Matterport facts. **Room boundaries with walls and doors** (`ModelRoom.boundary`, `holes`, floor `edges`, `vertices`) are Property Insights fields, "only enabled for organizations enrolled in the Property Insights graph extension", and Property Intelligence data "is only available for Enterprise-level Matterport Subscriptions". **Defurnished panoramas** exist only for spaces that already "contain a defurnished view". Assume we have neither.
2. What we can count on from a sponsor Matterport model, with no purchase: every sweep's 3D `position`, its `floor` and `room`, a `neighbors` list (sweeps visible from this one, which is a ready made walkable graph), 2048 px skybox panoramas, room `label`s, floor `sequence`, and Mattertags with 3D positions. That is enough for a real route graph, real landmarks and a real synced 3D view.
3. The mesh (MatterPak OBJ and point cloud) is a **purchase** through `unlockModelBundle(bundleId: "mp:matterpak")`. Do not plan on it. There are two cheap ways to get real Matterport wall geometry without it (section 2.4).
4. The **Showcase SDK** gives the sighted judge a strong visual: `Sweep.moveTo(sweepId, {rotation, transition, transitionTime})` and `Camera.pose` let the 3D tour follow the audio traveller live. It needs an SDK key with our domains allowlisted and a public or unlisted model.
5. **Vexcel**: API v1 was deprecated on 6 July 2026; use v2 (`https://api.vexcelgroup.com/v2/`) or the Vexcel MCP server (`https://api.vexcelgroup.com/v2/mcp`). Oblique photos come from the Urban Area program ("major metro areas"). LA and Houston are very likely covered. **Princeton obliques are unconfirmed**; the nationwide program is ortho and DSM only.
6. **CoStar has no public API**, so everything depends on the sponsor kit. JRR almost certainly has no CoStar record (university owned academic building, and the kit covers Houston and LA). Our own earlier CoStar idea treated the kit as "homes for sale" in LA and Houston, so there is a real risk the kit has **no tenant or suite fields at all**. Ask the CoStar mentor in the next 15 minutes.
7. **Recommended strategy: two buildings, one engine, every fact badged with where it came from.** JRR is traced by hand for the blindfold run and the real walk. A Houston or LA building from the kit runs the full name → CoStar → Matterport → Vexcel pipeline with the Showcase view synced to the audio. Frame JRR's hand trace as the cost our product removes.

---

## 1. Matterport

### 1.1 Model API (GraphQL) [VERIFIED unless marked]

Endpoint `https://api.matterport.com/api/models/graph`; auth with an API Token ID and Token Secret from Matterport Cloud developer tools. "Accounts have only Sandbox mode enabled by default." Source: https://developers.matterport.com/api/model/overview/

**Sandbox limit.** `Model.demo`: "Demo models are the only ones accessible in sandbox mode." The samples page: "The models() query will only return your demo model." So a self made sandbox key cannot see a sponsor's Houston or LA models; we need the sponsor's production token or models shared into an account with production access. Sources: https://static.matterport.com/api-doc/2024.11.50-main-g99fa2e3/reference/graphdoc/model/model.doc.html , https://developers.matterport.com/api/model/samples/

**Sweeps (locations).** The documented sample query:
```graphql
query getSweeps($modelId: ID!) {
  model(id: $modelId) {
    locations { id position { x y z } floor { id } room { id }
      panos { id skybox(resolution: "2k") { id status format children } } } } }
```
`AnchorLocation` also has `neighbors: [ID!]` ("other anchors visible from this panoramic image"), `tags`, `pano(variant)`, `panoImageVariants`. Sources: https://developers.matterport.com/api/model/samples/ , https://static.matterport.com/api-doc/2024.11.50-main-g99fa2e3/reference/graphdoc/model/anchorlocation.doc.html

**Panoramas.** "Panoramic images are currently only available as skyboxes." Six faces; resolutions low 512, high 1024, 2k 2048 per face; 4096 needs the Advanced Imagery add-on. `children` holds the six face URLs. No equirectangular from the API (the SDK can make one, see 1.3). Download links "will often only be valid for a short period of time" (`validUntil`). Source: samples page above; https://static.matterport.com/api-doc/2024.11.50-main-g99fa2e3/reference/graphdoc/model/modelassets.doc.html

**Floors.** `ModelFloor`: `id`, `label`, `sequence` ("spatially lowest floor starts at sequence 0"), `rooms`, `mattertags`, `panoLocations`, `locations`. `dimensionEstimates`, `edges`, `vertices` are Property Insights only. Source: https://static.matterport.com/api-doc/2024.11.50-main-g99fa2e3/reference/graphdoc/model/modelfloor.doc.html

**Rooms.** `ModelRoom`: `id`, `label`, `floor`, `tags` ("Cortex generated classifiers"), `dimensionEstimates(units)`, `ceiling`, `panoLocations`. **`boundary` ("The overhead view of the room's boundaries (e.g. walls, doors, etc.)"), `holes`, `classifications`, `keywords` are Property Insights only.** Source: https://static.matterport.com/api-doc/2024.11.50-main-g99fa2e3/reference/graphdoc/model/modelroom.doc.html

**Tags.** `mattertags(includeDisabled: true) { id floor { id } position anchorPosition discPosition stemNormal stemLength label description media mediaType }`. Source: samples page.

**Floor plan images.** `assets { floorplans(provider: "matterport", flags: [photogramy]) { floor { label sequence } format flags url origin { x y } width height resolution } }`. Units of `origin` and `resolution` are not stated (the sample shows `resolution: 100`) **[UNKNOWN: probably pixels per metre with origin in model metres; check against two sweep positions]**. Whether this returns anything without a purchase is **[UNKNOWN]**; the MatterPak includes a "High Resolution Photogrammetry Floorplan".

**Other model fields worth querying.** `address`, `geolocation` (lets us join a Matterport model to a CoStar property and place it for Vexcel), `labels`, `objectAnnotations` (Beta, vision pipeline detections with confidence) **[UNKNOWN whether populated on kit models]**, `views(types: ["matterport.model.defurnished"])`.

**MatterPak.** Ordered with `unlockModelBundle(id: $modelId, bundleId: "mp:matterpak")`. Contents: "High Resolution OBJ/MTL, Colorized Point Cloud, Reflected Ceiling Plan Image, High Resolution Photogrammetry Floorplan." E57 is a separate add-on `mp:e57`. Price not given ("Pricing for Add-Ons may vary based on account type"). Status and URLs through `getAddOns` → `bundles { assets { status filename format url validUntil } }`; retrieval through `model { bundle(id: "mp:matterpak") { assets { url } } }`. "Purchased assets ... are also accessible once unlocked." Sources: https://developers.matterport.com/api/model/ordering-addons/ , overview page.
`assets.meshes` exists with `format`, `resolution`, `url`, `validUntil`, but format values are not documented **[UNKNOWN: whether a usable mesh is returned without MatterPak; community reports Matterport's own `.dam` format, not verified]**.

**Defurnish.** The API exposes a defurnished view ("Spaces that contain a defurnished view have a secondary set of panoramic images"), queried with `views(types:["matterport.model.defurnished"])`. Whether any kit model has one is **[UNKNOWN]**; Matterport's own blog calls defurnishing "an under-development capability". Treat furnished vs defurnished comparison as cut. Source: https://matterport.com/es/blog/all-we-want-is-an-empty-room-how-emptying-your-digital-twin-unlocks-design

**Property Intelligence / Property Insights.** Exists: room names, room and floor dimensions, "wall measurements", "information to recreate room boundaries", "vector data to redraw a floorplan", via `dimensionEstimates`, `floors`, `rooms`. "Only available for Enterprise-level Matterport Subscriptions." Since CoStar owns Matterport (acquisition completed 28 Feb 2025), the sponsor might have it enabled; it is worth one question to the mentor and one query. Sources: https://developers.matterport.com/api/property-intelligence/ , https://matterport.com/news/costar-group-completes-acquisition-of-matterport-ushering-in-a-new-era-of-3d

**Rate limits.** Not documented anywhere we found **[UNKNOWN]**. Cache every response under `data/raw/matterport/` and run offline after the first pull.

### 1.2 What this means for the spec's Matterport row

| Spec claims | Reality tonight |
|---|---|
| Point cloud and mesh | Purchase only (MatterPak). Use fallbacks in 2.4. |
| Room boundaries, door openings | Enterprise Property Insights only. Probe once; assume no. |
| Room labels | Yes (`rooms.label`, `labels`). |
| Panoramas with camera positions | Yes, 2048 px skyboxes plus `position`, `floor`, `room`, `neighbors`. |
| Defurnished panoramas | Only if the space has a defurnished view. Assume no; cut the fixed vs movable claim or mark it "traced by hand". |

### 1.3 Showcase SDK (embedded 3D viewer) [VERIFIED]

- **Embedding.** Create an SDK key under Developer Tools, "SDK Key Management", and "add any desired local domains to the allow list (for example, `localhost` and `localhost:8080`)". "Your SDK key is unique to your website domain." So add the tunnel domain used for the phone demo too. Connect with `const mpSdk = await connect(iframe)` after the iframe loads; key in `applicationKey` URL parameter or importmap. Source: https://matterport.github.io/developer-docs/embed-sdk/
- **Which models.** "Showcase share URLs can be embedded within a webpage only if they are unlisted or public." Private models need Private Model Embed, "currently only available to Enterprise Customers". Source: https://matterport.github.io/showcase-sdk/oauth_private_model_embed.html . Whether an SDK key on a sandbox account can drive a sponsor's public model is **[UNKNOWN; test in 10 minutes with the kit model id]**.
- **Move the camera to a sweep.** `Sweep.moveTo(sweep: string, options: { rotation?, transition?, transitionTime? }): Promise<string>`; rotation `x` is pitch (-90 to 90), `y` is yaw, "the same rotation format returned by `Camera.pose`"; transitions FLY, FADEOUT, INSTANT. Source: https://matterport.github.io/showcase-sdk/docs/reference/current/modules/sweep.html
- **Read the camera.** `Camera.pose` observable gives `position`, `rotation`, `sweep`, `mode`. `Camera.setRotation`, `Camera.rotate`, `Camera.moveInDirection`. Source: https://developers.matterport.com/reference/camera/
- **All sweeps in the viewer frame.** `Sweep.data` observable map with `position`, `floorInfo {id, sequence}`, `neighbors`, `enabled`, `rotation`.
- **Raycast into the real mesh, no download.** `Renderer.getWorldPositionData(screenPosition, height?, includeHiddenFloors?)` "Converts a screen position into a world position", returning the first raycast hit (null if it misses). Also `Renderer.takeScreenShot(resolution, visibility)` up to 4096 x 4096, and `Renderer.takeEquirectangular()` of the active sweep (Panorama mode only). Source: https://matterport.github.io/showcase-sdk/docs/reference/current/modules/renderer.html
- `Pointer.intersection` gives `position`, `normal`, `floorIndex` for wherever the mouse points; there is no programmatic ray function in the Pointer module. Source: https://matterport.github.io/showcase-sdk/docs/reference/current/modules/pointer.html

**Demo value.** For sighted judges: the audio traveller moves on our grid; on every step we find the nearest sweep (in the same frame) and call `Sweep.moveTo(nearest, {rotation: {x: 0, y: heading}, transition: FADEOUT, transitionTime: 400})`, or `Camera.setRotation` when the sweep has not changed. The tour walks with the blindfolded person, so the room sees what the listener hears. A sighted guide can also preview the route this way. This works only on a Matterport building, which is one more reason the sponsor building must be in the demo.

---

## 2. Matterport geometry without a MatterPak (ranked fallbacks)

### 2.1 Sweep graph (60 min, real, low risk)
Nodes are sweeps (`position`, `floor`, `room`); edges are `neighbors`. Every edge is a line of sight the scanner crossed, so it is walkable in practice. Run the cane friendly cost on edges (turns, room changes, distance), and attach Mattertags and room labels as landmarks. It gives a real route ("through the waiting room, past the pharmacy tag, to reception") with no mesh. Weakness: no walls, so no wall side and no cane taps. Use it as the route skeleton and for the Showcase sync.

### 2.2 Floorplan screenshot, scaled by sweeps (45 min, real, medium risk)
In the embedded Showcase, switch to Floorplan mode, `Renderer.takeScreenShot({width: 4096, height: 4096})`, then compute the screen positions of two far apart sweeps (`Conversion.worldToScreen`) to get exact metres per pixel and the model frame origin. Load it into the existing trace tool (Task 3) instead of an evacuation plan photo. The trace is then in the Matterport frame, so the Showcase sync needs no extra alignment. If `assets.floorplans` already returns the photogrammetry floorplan with `origin` and `resolution`, use that instead and skip the screenshot. Badge: walls "traced by hand from Matterport floorplan".

### 2.3 Virtual LIDAR from the SDK (2 to 3 h, real geometry, high risk)
At each sweep: `moveTo`, set pitch 0, then sample `getWorldPositionData` across the screen width while rotating four times by 90 degrees. Rasterise hits within 0.3 m of camera height into walls. This yields walls traced by Matterport's own mesh, automatically, with no purchase. Only do this if B (spatial) is ahead of schedule by midnight; it is the most impressive "data use" story, but each ray is an async call and glass still gives holes.

### 2.4 MatterPak OBJ (only if the kit already has it unlocked)
Run Task 2 as written. Check `getAddOns` first. Never buy one tonight.

### Landmark placement without a mesh
The plan says vision labelling needs the mesh. It does not: label a skybox face with the vision model, convert the pixel to a bearing from the sweep's known position, and raycast that bearing in our 2D occupancy grid to the first obstacle cell. Or triangulate the same label seen from two sweeps. Speak results with confidence below 0.6 as "possibly".

---

## 3. Vexcel

### 3.1 Verified facts
- **API v2.** Docs at `https://api.vexcelgroup.com/v2/`. "API 1.0 was deprecated on July 6, 2026." Login `/auth/login` with `username` and `password` returns a token; the migration guide says tokens last 24 hours. Find imagery at a point: `/oriented/collections?wkt=POINT(lon lat)&srid=4326&layer=urban-g&token=...`. Sources: https://vexcel.atlassian.net/wiki/spaces/APIDOCS/overview , https://vexcel.atlassian.net/wiki/spaces/APIDOCS/pages/3035136040/API+Migration+Guide+from+1.0+to+2.0
- **The v2 endpoint that crops one oblique image around a point and returns a JPEG is [UNKNOWN]** (v1.4 had `ExtractImages` and `FindImage`; those pages now 404 anonymously). Get it from the Vexcel mentor or the token page's "View Documentation" link after login.
- **Vexcel MCP.** Server `https://api.vexcelgroup.com/v2/mcp`, auth with an API key (`X-API-KEY` header) or a token that expires every 12 hours. Covers orthomosaic, "Oblique and nadir aerial photos", DSM and DTM "in meters", property metadata including building footprints, roof condition, pools. "The products you can query match your Vexcel product licensing." Sources: https://vexceldata.com/?p=28421 , https://vexceldata.com/?p=26742 . This is a gift for "agent depth": the orchestrator can call Vexcel as a tool directly.
- **Products.** Oblique, Ortho, 3D Cities, Elevate (DSM), Gray Sky, Multispectral; Elements: Property Attributes, Roadways, Damage Assessment. Access via API, Viewer, MapControl SDK, ArcGIS image services, MCP. Source: https://vexceldata.com/platform/
- **Coverage.** Urban Area Collection captures 7.5 cm "oblique and ortho imagery of major metro areas"; the Wide Area program is ortho plus elevation only (15 cm). The new nationwide 7.5 cm program (announced 2 June 2026) is ortho, multispectral and DSM; "oblique imagery is provided through the continuing Urban Area Prime Collection Program in major cities", and its collection starts January 2027. Sources: https://prnewswire.com/news-releases/vexcel-data-program-enhances-wide-area-capture-program-in-us-and-europe-301383107.html , https://vexceldata.com/stories/vexcel-announces-the-first-nationwide-u-s-aerial-imagery-program-at-7-5cm-resolution/ , https://vexceldata.com/?p=3617
- **Princeton, NJ.** Wide Area ortho almost certainly covers it [INFERRED from nationwide wide area program]. **Obliques at Princeton: [UNKNOWN]**; Vexcel's coverage page shows New York and Staten Island obliques and no Princeton or Mercer County mention (https://vexceldata.com/2025). Probe with `/oriented/collections` at JRR.
- **LA.** Esri hosts a `Vexcel_Hollywood_Obliques` ImageServer with Export Image and Find Images operations (https://remotesensing.imagery.esri.com/image/rest/services/Vexcel_Hollywood_Obliques/ImageServer). Anonymous access and license not stated; useful only as a coverage hint.
- **Licensing.** Access is tied to the sponsor's licence. **[INFERRED]** Do not commit raw Vexcel imagery to a public repo; keep `arrival.jpg` in a gitignored folder, fetched at build time, and say "Imagery © Vexcel" on screen.

### 3.2 JRR facts for the arrival step
JRR is "the former Frick Chemistry Laboratories at 20 Washington Road", with "a new south atrium and bridge entrance" to the Simpson building on Scudder Plaza, an entrance court on the Washington Road side, and glazed rooftop pavilions (https://architizer.com/projects/julis-romo-rabinowitz-building-louis-a-simpson-international-building-princeton-university). So JRR has at least two plausible entrances, and the atrium is glass (scan holes, code 4). Take the lat and lon from a phone at the chosen door rather than the plan's approximate 40.3487, -74.6550.

---

## 4. CoStar

### 4.1 What is verified
- CoStar Group completed its acquisition of Matterport on 28 Feb 2025 and plans to integrate it with its "online marketplaces". So "Matterport inside a CoStar property" is the sponsor's own strategy, which is the "Inside and Out" story. Source: https://matterport.com/news/costar-group-completes-acquisition-of-matterport-ushering-in-a-new-era-of-3d
- No public CoStar API: "No public API for CoStar Suite, COMPS, Market Analytics, or LoopNet data" (third party review, https://supergood.ai/api-report-card/costar). So everything depends on the hackathon kit's schema.

### 4.2 What a hackathon kit plausibly exposes [INFERRED, confirm with mentor]
Property records (id, address, lat and lon, building name, property type such as medical office, floors, size, year built), tenant or occupier records (company name, floor, suite, size, industry), and availability or listing records (suite, floor, size, asking rent, listing photos or tour link). It may also be residential listings only. If the kit has a Matterport model id or tour URL on a listing, that is the join we need; otherwise join on address and `geolocation`.

### 4.3 JRR and CoStar
Expect no record: JRR is a university owned academic building, not leased commercial space, and the kit covers Houston and LA. Do not spend time looking. Hand build `data/directory.json` for JRR (already Task 14) and badge it "traced by hand".

### 4.4 Best honest way to show CoStar doing real work
1. **Visitor, "find my clinic".** On a kit city building: the user types a tenant name ("Sunrise Family Dental") → CoStar tenant search → property, floor, suite → co-tenants on that floor become spoken landmarks ("past the pharmacy") → Matterport model for that property → Vexcel entrance image. Every step shows its badge and the raw field it came from.
2. **Venue, rank vacant suites by navigability.** Interior scores need a scan of each suite, which we do not have. Be honest with a two part score:
   - **Arrival score, computed for every available listing** from Vexcel and CoStar: drop off to entrance distance, entrance visible in the oblique, floor number (elevator needed), suite distance from the core if the floor plate is known. Real data, many rows, ranked table.
   - **Interior score, only where a Matterport model exists** (the one kit building): route from entrance to each candidate room or suite on the sweep graph or traced grid, through C4 and C5.
   - Rows without a scan say "interior not scanned", not a made up number. This answers weakness 12 in the spec directly.
3. If the kit has **no tenant or suite data** (residential only): CoStar becomes "address or building name → property record and listings", the suite comes from Matterport room labels or tags, and the venue ranking uses whatever listings exist. Say this out loud in the pitch rather than faking a tenant search.

---

## 5. Failure modes tonight, with mitigations and time cost

| # | Layer | Failure mode | Likelihood | Mitigation | Time |
|---|---|---|---|---|---|
| M1 | Matterport | Keys have no JRR model | Near certain | JRR traced (Task 3, already planned). Make the trace the pitch point. | 0 |
| M2 | Matterport | Our key is sandbox, sees only the demo model | High if self made | Ask the CoStar or Matterport mentor for the kit's production token or a shared account. Fallback: the account's own demo model (a real space, labelled as Matterport's demo). | 15 min |
| M3 | Matterport | MatterPak locked | High | Sweep graph (2.1) plus floorplan screenshot trace (2.2). Virtual LIDAR (2.3) only if ahead. | 60 + 45 min |
| M4 | Matterport | Room boundaries and doors missing (Property Insights) | High | Doors from the trace, or neighbors edges that cross a traced wall line. Query `rooms { boundary }` once in case the sponsor org has it. | 5 min probe |
| M5 | Matterport | No defurnished view | High | Drop the fixed vs movable claim from the pitch; mark obstacles `fixed` from the trace. | 0 |
| M6 | Matterport | Signed URLs expire (`validUntil`) | Certain | Download skybox faces and floorplans immediately; store under `data/raw/`; never hot link in the demo. | 10 min |
| M7 | Matterport | Large or slow downloads on venue Wi-Fi | Medium | Pull only the route floor's sweeps at 2k; a few dozen sweeps × 6 faces. One machine downloads, then share by USB. | 20 min |
| M8 | Matterport | Rate limit (undocumented) | Low | One pull, cache, `DR_OFFLINE=1` for everything after. | 0 |
| M9 | Matterport | Showcase embed blocked: domain not allowlisted, or model private | Medium | Add `localhost`, the port, and the tunnel host to the SDK key allowlist. Use a public or unlisted kit model. Fallback: a static skybox viewer from the cached faces. | 15 min |
| M10 | Matterport | Multi floor model: wrong floor sliced or routed | Medium | Filter sweeps by `floor.id` of the destination; slice at that floor only; one floor route in the demo, elevator spoken as a landmark. | 15 min |
| M11 | Matterport | Axis convention differs between Model API `Point` and SDK `Vector3` (SDK follows three.js, likely y up; API frame unverified) | Medium | Pull one sweep from both and compare; store the axis swap in the package `frames` field (7.2); unit test it. | 20 min |
| M12 | Matterport | Glass and mirror holes (JRR south atrium) | High in mesh, low in trace | Trace glass as code 4; in a screenshot trace, draw glass along door lines the scanner looked through. | 15 min |
| V1 | Vexcel | No oblique at Princeton | Medium to high | Use ortho for JRR drop off; take one phone photo of the entrance at JRR, badge "traced by hand". Show the oblique on the LA or Houston building. | 15 min |
| V2 | Vexcel | v1 code or tutorials used by mistake (deprecated 6 July 2026) | Medium | Only v2 paths or the MCP. | 0 |
| V3 | Vexcel | Token expires (24 h API, 12 h MCP token) during judging | Medium | Refresh at 05:00; prefer an API key; cache the images anyway. | 5 min |
| V4 | Vexcel | Oblique extract endpoint unknown in v2 | Medium | Ask the Vexcel mentor; else MCP oriented imagery tool; else export from Vexcel Viewer and badge it "Vexcel (viewer export)". | 30 min |
| V5 | Vexcel | Footprint or property attributes not in our entitlement | Medium | Trace the footprint on the ortho in the trace tool, badge "traced by hand on Vexcel ortho". | 20 min |
| V6 | Vexcel | DSM too coarse to count steps | High | Say "a step or slight rise at the door" only when the DSM height change across the threshold exceeds 0.1 m; step counts at JRR come from walking it. | 0 |
| V7 | Both | Interior frame (Matterport metres, arbitrary origin and rotation) not aligned with exterior (WGS84) | Certain | Two control points: interior entrance position ↔ entrance pin on ortho, plus the facade wall bearing ↔ footprint edge bearing. Scale is 1 (both metric). Store in `frames.geo_anchor`. | 30 min |
| V8 | Vexcel | Trees or canopy hide the entrance | Medium | Pick the oblique look direction facing the entrance edge normal; human confirms (`confirmed: true` only after a check, already in Task 15). | 10 min |
| C1 | CoStar | No JRR record | Near certain | Hand directory, badged. CoStar shown on the kit building. | 0 |
| C2 | CoStar | Kit is residential only, no tenants or suites | Medium | Ask now. If true, resolver keys on building name or address; suite from Matterport labels or tags; say so in the pitch. | 15 min |
| C3 | CoStar | Tenant record lacks floor or suite | Medium | Orchestrator asks one question ("Which suite is your appointment in?"), or uses a matching Matterport tag. | 10 min |
| C4 | CoStar | No link from CoStar property to a Matterport model | High | Join on address and `geolocation` (within 50 m and same street number); log the join as "inferred". | 30 min |
| C5 | CoStar | Kit has no Matterport model of a public facing or medical building | Medium | Use the most public facing commercial model available (lobby, reception); call it "a Houston office building" truthfully. | 0 |
| X1 | All | Venue Wi-Fi fails at judging | Medium | Everything cached; packages prebuilt; Showcase falls back to cached skybox viewer. | (Task 16) |

---

## 6. Data provenance UI

Goal: judges see each layer doing work in every screen, and a blind user can ask "how do you know that?".

**Badge per fact.** A small chip after every fact on screen:

| Chip | Meaning | Colour |
|---|---|---|
| `MP` Matterport | Value read from the Model API or SDK (sweep position, room label, tag, floorplan) | Matterport brand-neutral blue |
| `VX` Vexcel | Ortho, oblique, DSM, footprint | Green |
| `CS` CoStar | Tenant, suite, co-tenant, listing, property type | Orange |
| `HAND` Traced by hand | Our team drew or paced it (JRR walls, JRR directory, phone photo) | Grey, dashed outline |
| `CALC` Computed | Our geometry code derived it from the layers above (step counts, wall side, score, entrance side) | Outline only, lists its inputs |
| `AI` Vision model | Landmark labels from panoramas, with confidence; below 0.6 shows "possibly" | Purple |

Click or tap a chip: the raw source path and time, for example `Matterport Model API · model.mattertags[7].position · pulled 21:14` or `CoStar kit · tenants[“Sunrise Family Dental”].suite`. `CALC` chips list their inputs as chips, so a step count shows `CALC ← MP sweep 12, MP sweep 15`.

**Layer meter.** One line at the top of each building: `This rehearsal: 41 facts · MP 23 · VX 4 · CS 5 · HAND 0 · CALC 9`. For JRR it reads `HAND 31`. Putting the two side by side is the pitch.

**Accessible.** Chips carry `aria-label="source: Matterport scan"`. In the rehearsal, pressing S (or a two finger tap) speaks the source of the current instruction: "Desk position from the Matterport scan tag. Entrance from a Vexcel aerial photo, checked by a teammate." This helps trust and costs one keybinding.

**Contract change** (optional fields, so Task 1 tests still pass):
```ts
type Source = "matterport"|"vexcel"|"costar"|"hand"|"calc"|"ai";
interface Prov { src: Source; ref: string; at: string; inputs?: string[]; confidence?: number; }
// BuildingPackage gains:
//   prov: Record<string, Prov>   // key = fact id, e.g. "landmark:desk", "segment:s2.steps",
//                                //       "arrival.entrance_side", "resolver.suite"
//   frames: { plan_from_matterport: number[] | null;   // 3x3 2D affine, row major
//             geo_anchor: { lat: number; lon: number; plan_pos: Vec2; plan_north_deg: number } | null }
```
Each producer (probe, trace import, resolver, arrival, instructions) writes its own `prov` entries. The UI renders a chip for any fact id it shows. About 45 minutes for engine plus 45 for web.

---

## 7. Recommended data strategy for the next 12 hours

### 7.1 Two buildings, one engine, labelled honestly

| | **JRR (Princeton)** | **Kit building (Houston or LA)** |
|---|---|---|
| Role in demo | Blindfold rehearsal and real walk; Healthcare and Amazon story | Full pipeline from a name; CoStar and data use story; Showcase synced view |
| Interior | `source: traced` from the evacuation plan; badges `HAND` | Sweep graph + floorplan trace in the Matterport frame (or OBJ if already unlocked); badges `MP` |
| Landmarks | Placed by hand | Mattertags, room labels, optional vision labels on skyboxes |
| Exterior | Vexcel ortho; oblique if covered; else phone photo `HAND` | Vexcel oblique + ortho |
| Directory | `data/directory.json` `HAND` | CoStar tenant → floor → suite; co-tenants as landmarks |
| Venue | Reception placement before and after (Task 12) | Ranked available suites: arrival score for all, interior score where scanned |

**Why not the reverse** (Matterport on JRR, trace for the sponsor building): we have no JRR scan. **Why not one building only**: JRR alone gives CoStar nothing to do (loses most of the 30% data use); the kit building alone loses the blindfold then walk moment, which is the best 15% demo beat and the Healthcare story.

### 7.2 Framing for judges (say it in these words, roughly)
"Princeton has no scan we can reach, so we traced JRR from the fire plan. It took us 40 minutes, and every fact from it is grey: traced by hand. That 40 minutes per building is exactly why audio rehearsal never spread. Now the Houston building: nobody on our team has been there, and every badge is Matterport, Vexcel or CoStar." Then show the layer meters side by side. This turns our biggest data gap into the core claim.

### 7.3 Order for A (data) from 20:00
1. 20:00 to 20:15: ask the CoStar mentor three questions: production Matterport token or shared models; which kit models are public facing or medical; does the CoStar kit have tenant floor and suite fields. Ask the Vexcel mentor for the v2 oblique extract call and whether Princeton has obliques.
2. 20:15 to 21:00: Task 0 probe on one kit model: sweeps with neighbors, rooms, tags, floorplans, `getAddOns`, `rooms { boundary }` (Property Insights check), defurnished view. Vexcel `/oriented/collections` at JRR and at the kit building. Write `DATA_STATUS.md`.
3. 21:00 to 22:00: Task 14 resolver against the real kit schema; save fixtures.
4. 22:00 to 23:00: sweep graph importer (new Task 2a below).
5. 23:00 to 00:30: Showcase sync (new Task 17) with C; floorplan screenshot handed to D for tracing in the Matterport frame.
6. 00:30 to 02:00: Task 15 arrival on both buildings; `frames.geo_anchor`.
7. 02:00 to 03:00: provenance entries in every producer; arrival score for listings.
8. 05:00: refresh Vexcel token; confirm all caches; no live calls needed for the demo.

---

## 8. Plan amendments (in the plan's style)

### Changes from the spec (additions)

9. **Matterport room boundaries, door openings and defurnished panoramas are treated as unavailable** (Property Insights is Enterprise only; defurnish only exists where a defurnished view was made). Doors come from the trace; fixed vs movable comes from the trace.
10. **Two demo buildings with distinct roles.** JRR (traced) for the blindfold run and walk; one kit building (Houston or LA) for the live name → CoStar → Matterport → Vexcel pipeline and the Showcase view.
11. **Mesh is optional.** The kit building's geometry comes from the sweep graph plus a floorplan screenshot traced in the Matterport frame. Task 2 runs only if a MatterPak is already unlocked.
12. **Every fact carries provenance** (`prov` in the package), shown as badges and spoken on request.
13. **Venue ranking of listings is two part**: arrival score for all available listings, interior score only where a scan exists. No invented interior numbers.

### Shared contract: BuildingPackage v1 (additive)
Add optional `prov: Record<string, Prov>` (default `{}`) and `frames` (default both null) as in section 6. `source` gains `"matterport_sweeps"` for a package built from the sweep graph and a Matterport floorplan trace.

### Task 0 (revised): Data probe (A, 45 min, now)

- [ ] **Step 1:** `python -m dr.probe --matterport <kit_model_id>` runs, and saves raw JSON for: `locations { id position floor { id sequence } room { id label } neighbors panos { skybox(resolution: "2k") { children } } }`, `floors { id label sequence }`, `rooms { id label tags }`, `mattertags { id label position floor { id } }`, `assets { floorplans { url origin { x y } resolution width height floor { sequence } } }`, `bundles { id availability }`, `geolocation`, `address`, `views(types: ["matterport.model.defurnished"]) { id }`, and separately `rooms { boundary }` (expect a permission error).
- [ ] **Step 2:** Vexcel: `/auth/login`, then `/oriented/collections?wkt=POINT(lon lat)&srid=4326&layer=urban-g` at JRR (phone GPS at the chosen door) and at the kit building. Record whether obliques exist.
- [ ] **Step 3:** CoStar: one tenant search, one property, one availability query from the kit; record which fields exist (floor, suite, co-tenants, Matterport link).
- [ ] **Step 4:** `docs/DATA_STATUS.md`: one row per layer and building, with `JRR_SOURCE=traced` and `KIT_SOURCE=matterport|matterport_sweeps`. Commit.

### Task 2a: Sweep graph and Matterport floorplan import (A, 60 min, then D 45 min tracing)

**Files:** Create `engine/dr/mp_sweeps.py`, `engine/tests/test_mp_sweeps.py`

**Interfaces:**
- Produces `load_sweeps(raw_json_path) -> SweepGraph` with `nodes: dict[id, {pos: Vec2, z: float, floor: int, room: str|None}]`, `edges: set[tuple[id, id]]` from `neighbors` (symmetrised), axis swap applied from `frames`.
- Produces `sweep_landmarks(raw) -> list[Landmark]` from Mattertags (kind guessed from the label by keyword, confidence 0.8, `prov.src = "matterport"`).
- Produces `floorplan_scale(screens: dict[id, Vec2px], world: dict[id, Vec2]) -> (m_per_px, origin)` from two or more sweeps for the trace tool.
- [ ] **Step 1: Failing tests** `test_neighbors_symmetric`; `test_floor_filter` (only sweeps with the requested floor sequence); `test_scale_from_two_sweeps` (two sweeps 10 m apart, 500 px apart, gives 0.02 m per px).
- [ ] **Step 2 to 4.** Fail, implement, pass. Commit.
- [ ] **Step 5:** D traces the floorplan screenshot with the computed scale; the resulting `trace.json` is in the Matterport frame.

### Task 14 (amended): Data resolver
- `resolve()` also returns `prov` for each field. Join CoStar property to Matterport model by `geolocation` within 50 m plus street number match; mark the join `src: "calc"` with both inputs.
- If the kit has no tenant records, `resolve()` accepts a building name or address and `suite` comes from a Matterport room label or tag (`src: "matterport"`).

### Task 15 (amended): Arrival
- Uses Vexcel v2 or the Vexcel MCP only (v1 is deprecated). If no oblique exists at the point, use ortho and an optional phone photo with `prov.src = "hand"`.
- Writes `frames.geo_anchor` from the confirmed entrance pin and the facade bearing.
- Adds `arrival_score(listing) -> {total, parts}` for the venue table: drop off to entrance metres, entrance visible (bool, human confirmed), floor number, and `interior: null` when no scan exists.
- Refresh the Vexcel token at 05:00 (Task 16 checklist).

### Task 17: Showcase sync view (A with C, 90 min, kit building only)

**Files:** Create `web/src/showcase/sync.ts`, `web/src/showcase/sync.test.ts`

**Interfaces:**
- `connectShowcase(iframe, modelId, key) -> Promise<Sdk | null>`; null on any failure, and the app continues without it.
- `nearestSweep(pos: Vec2, sweeps, floor) -> id` in the plan frame via `frames.plan_from_matterport`.
- `follow(traveller)`: on step, if the nearest sweep changed, `Sweep.moveTo(id, {rotation: {x: 0, y: yaw(heading)}, transition: FADEOUT, transitionTime: 400})`; else `Camera.setRotation` on turns, throttled to 4 per second.
- [ ] **Step 1: Failing tests** `nearest sweep picks closest on same floor`; `follow does not call moveTo twice for the same sweep`; `sdk failure leaves rehearsal running` (mock `connect` rejecting).
- [ ] **Step 2 to 4.** Commit. Allowlist `localhost`, the dev port and the tunnel host on the SDK key before testing on phones.

### Task 18: Provenance badges (C web, all producers, 90 min total)
- Engine: every producer writes `prov` entries. Web: chip component, layer meter per building, S key speaks the source of the current instruction.
- [ ] **Test** `every spoken number has a prov entry` (extends the Task 6 validator); `layer meter counts match prov`.

---

## 9. Open unknowns to resolve tonight (ranked)

1. Does the kit give production Matterport access to Houston or LA models, and are any public facing or medical? (mentor)
2. Does the CoStar kit have tenant, floor, suite fields, and any Matterport link? (mentor, probe)
3. Vexcel v2 call to extract one oblique by point and direction; Princeton oblique coverage. (mentor, probe)
4. Is any kit model's MatterPak already unlocked? (`getAddOns`)
5. Does `assets.floorplans` return a floorplan without purchase, and what are `origin` and `resolution` units?
6. Does the sponsor org have Property Insights (`rooms { boundary }`)?
7. Model API `Point` axes vs SDK `Vector3` axes.
8. Can an SDK key from our account drive the kit's public model on our domains?

## Sources
- Matterport Model API overview: https://developers.matterport.com/api/model/overview/
- Model API samples (sweeps, skyboxes, defurnished views, tags, floorplans, sandbox notes): https://developers.matterport.com/api/model/samples/
- Model API searchable fields: https://developers.matterport.com/api/model/queries/
- Model type reference: https://static.matterport.com/api-doc/2024.11.50-main-g99fa2e3/reference/graphdoc/model/model.doc.html
- ModelRoom: https://static.matterport.com/api-doc/2024.11.50-main-g99fa2e3/reference/graphdoc/model/modelroom.doc.html
- ModelFloor: https://static.matterport.com/api-doc/2024.11.50-main-g99fa2e3/reference/graphdoc/model/modelfloor.doc.html
- AnchorLocation: https://static.matterport.com/api-doc/2024.11.50-main-g99fa2e3/reference/graphdoc/model/anchorlocation.doc.html
- ModelAssets: https://static.matterport.com/api-doc/2024.11.50-main-g99fa2e3/reference/graphdoc/model/modelassets.doc.html
- Mesh: https://static.matterport.com/api-doc/2024.11.50-main-g99fa2e3/reference/graphdoc/model/mesh.doc.html
- Ordering add-ons (MatterPak): https://developers.matterport.com/api/model/ordering-addons/
- Property Intelligence: https://developers.matterport.com/api/property-intelligence/
- Embed SDK: https://matterport.github.io/developer-docs/embed-sdk/
- Sweep module: https://matterport.github.io/showcase-sdk/docs/reference/current/modules/sweep.html
- Camera module: https://developers.matterport.com/reference/camera/
- Renderer module: https://matterport.github.io/showcase-sdk/docs/reference/current/modules/renderer.html
- Pointer module: https://matterport.github.io/showcase-sdk/docs/reference/current/modules/pointer.html
- Private model embed: https://matterport.github.io/showcase-sdk/oauth_private_model_embed.html
- Defurnish blog: https://matterport.com/es/blog/all-we-want-is-an-empty-room-how-emptying-your-digital-twin-unlocks-design
- CoStar completes Matterport acquisition: https://matterport.com/news/costar-group-completes-acquisition-of-matterport-ushering-in-a-new-era-of-3d
- CoStar API availability (third party): https://supergood.ai/api-report-card/costar
- Vexcel API docs space (v1 deprecation): https://vexcel.atlassian.net/wiki/spaces/APIDOCS/overview
- Vexcel migration guide 1.0 to 2.0: https://vexcel.atlassian.net/wiki/spaces/APIDOCS/pages/3035136040/API+Migration+Guide+from+1.0+to+2.0
- Vexcel API 2.0 doc note: https://support1.vexceldata.com/knowledge/vexcel-api-2.0-documentation
- Vexcel platform: https://vexceldata.com/platform/
- Vexcel MCP: https://vexceldata.com/?p=26742 and https://vexceldata.com/?p=28421
- Vexcel Urban Area collection: https://vexceldata.com/?p=3617
- Vexcel wide area program: https://prnewswire.com/news-releases/vexcel-data-program-enhances-wide-area-capture-program-in-us-and-europe-301383107.html
- Vexcel nationwide 7.5 cm program: https://vexceldata.com/stories/vexcel-announces-the-first-nationwide-u-s-aerial-imagery-program-at-7-5cm-resolution/
- Vexcel US coverage page: https://vexceldata.com/2025
- Esri Vexcel Hollywood obliques: https://remotesensing.imagery.esri.com/image/rest/services/Vexcel_Hollywood_Obliques/ImageServer
- JRR building description: https://architizer.com/projects/julis-romo-rabinowitz-building-louis-a-simpson-international-building-princeton-university
- HackPrinceton (CoStar sponsor, venue JRR): https://www.hackprinceton.com
