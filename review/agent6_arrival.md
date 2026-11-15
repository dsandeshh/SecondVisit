# Agent 6: curb to door (arrival), rehearsal and day of visit

Written Saturday 14 Nov 2026, about 23:30 ET. Scope: the stretch from the car door to the clinic door at
the Houston Medical Office (Matterport `x37LjPx62VA`, CoStar 5615020, model lat/lon 29.9666445,
-95.5394043), as a rehearsal at home and as an optional companion on the day. Reads with
`docs/APIS.md` section 3, `docs/DESIGN.md`, `docs/plan.md` Task 15 and `review/agent2_data.md` (V1 to V8).

Status words used below:

* **verified (team)**: our own team ran it (only ortho extract so far).
* **verified (peer)**: another HackPrinceton team ran it today with the same kind of hackathon key and
  published the request in a public repo. Strong hint, not our proof. Run it once yourself before relying on it.
* **spec**: read in Vexcel's OpenAPI pages (`https://api.vexcelgroup.com/v2/api-docs/<product>`), never run by anyone we know of.
* **unverified**: our inference.

Note: this agent's sandbox cannot reach `api.vexcelgroup.com` (egress proxy refuses it), so nothing
below was run from here. All calls must be run by lane A on a team laptop.

---

## 0. Verdict in one screen

**Buildable tonight, ranked (P0 first):**

1. Geo frame (`frames.geo_anchor`) and the four transform functions, with round trip tests. S, P0, CALC.
2. Curb script: 6 to 8 spoken lines computed from the two HAND pins, with an explicit reference
   direction, step count and **recovery lines** ("if you touch a wall with no door, trail it to your
   right"). S, P0, HAND plus CALC.
3. Outdoor three.js scene: Vexcel ortho draped on a ground quad, building massing, curb and door pins,
   canopy slab, blue path, traveller disc, then a fly through the door into the interior scene in the
   **same world frame**. M, P0, VX plus HAND plus MP plus CALC.
4. Outdoor audio: traffic bed placed on the road side, door beacon, canopy "sound closes in" reverb
   change, edge tick at the aisle to sidewalk transition, crossfade into the interior. S to M, P0.
5. GPS error circle drawn on the ground around the drop off (radius 10 m, "typical phone error"):
   it is bigger than the whole 7.5 m walk, which is the honest argument for rehearsal. S, P1 (cheap, high value).
6. Vexcel oblique of the entrance with a crosshair on the door pin, for the judge panel. S, P1, VX.
7. Day of visit page with "I'm here", GPS plus compass beacon, the same rehearsed lines advanced by the
   user, disclaimer, "call a sighted helper", and a **simulated arrival** replay for the demo (we are in
   New Jersey, the clinic is in Houston). M, P1.
8. DSM line profile curb to door (`dsm/elevation`) for "level" vs "possible step", canopy height and
   building height. S to M, P1, VX.
9. Open vocabulary detection (`elements/detect`, SAM 3) for cars, parking spaces, trees, poles near the
   path, as AI chips. M, P1 or later.
10. Later: Vexcel property footprint, Vexcel 3D mesh tiles (photo mesh of the real exterior), embedding
    search, Vexcel MCP as an agent tool.

**Honest limits of day of visit mode:** phone GPS is about 5 m at best and about 10 m typical near
buildings; the whole curb to door walk here is 7.5 m. So GPS can tell the person "you are at the
building, roughly on the right side" and can point a coarse beacon if the driver left them 30 m or more
away. It cannot guide the 11 steps, find the curb edge, see cars, or work indoors. The last 7.5 m are
done by the cane or dog plus the rehearsed mental map; the app's job there is to replay the lines on
demand, not to position.

---

## 1. Vexcel v2: what helps an outdoor pedestrian scene

Base `https://api.vexcelgroup.com/v2`, header `X-API-KEY`. Docs: the API 2.0 reference lives at
`https://api.vexcelgroup.com/v2/` and "can be accessed with your Vexcel Viewer credentials"
(https://support1.vexceldata.com/knowledge/vexcel-api-2.0-documentation). The per product OpenAPI pages
`/v2/api-docs/oriented`, `/v2/api-docs/dsm`, `/v2/api-docs/property`, `/v2/api-docs/embedding` were
readable without login today; the full spec is `/v2/api-docs` (about 840 KB). API 1.0 is deprecated
(https://vexcel.atlassian.net/wiki/spaces/APIDOCS/pages/3035136040/API+Migration+Guide+from+1.0+to+2.0).

Coverage for hackathon keys: geofenced to greater Houston and greater LA (403 elsewhere, our APIS.md and
a peer team's test). A peer team reported late on 14 Nov that Princeton (Trenton 2026 collection) also
started answering (https://github.com/burvy/golden, DESIGN.md). Not needed for us; our building is Houston.

### 1.1 Feature table

| # | Endpoint | Gives us | Status | Use in arrival | Priority |
|---|---|---|---|---|---|
| V1 | `POST /ortho/extract` | North up orthophoto, 7.5 cm | verified (team) | Ground texture of the outdoor scene; pocket summary photo | P0 |
| V2 | `GET /oriented/extract` with `product-type=oblique-north|south|east|west` | One oblique photo around a point, cropped by `buffer-meter` or `bbox-dimensions`; optional `crosshair` drawn on a point | spec; peer teams call `/oriented/extract` (https://github.com/chjch/3Dcitymodeling, https://github.com/burvy/golden) | Entrance photo for judges with a reticle on the door pin; input to the vision model for canopy, door type, curb ramp | P1 |
| V3 | `GET /oriented/query`, `/oriented/collections` | List of images and collections at a point, by product type | spec (collections is in the migration guide) | Probe: are obliques available at this building; which collection and date | P1 (one call) |
| V4 | `GET /oriented/transform-points` `operation=world-2-pixel` | Pixel of a lon/lat point in a named oblique image | spec | Draw our own door and curb pins on the oblique (if `crosshair` is not enough) | later |
| V5 | `GET /dsm/elevation` | Takes a 2D WKT, returns it with Z in metres | spec | Height profile along the curb to door line: level route or possible step; canopy height | P1 |
| V6 | `GET /dsm/extract` | GeoTIFF of the surface, metres over EGM2008 | spec; peer team runs it (https://github.com/burvy/golden) | Building height for the massing; canopy footprint near the door | P1 |
| V7 | `POST /elements/detect` | Open vocabulary detection (SAM 3): you type the label, it returns lon/lat boxes with confidence | verified (peer) in LA (https://github.com/burvy/golden/blob/HEAD/docs/burvy/detect-probe.md) | Cars, parking spaces, trees, poles, bollards near the path, as AI hazards | P1 or later |
| V8 | `GET /property/extract` | GeoJSON: parcel geometry, `footprint.wkt`, `footprint.area`, roof characteristics, `hardscapes`, `vehicles`, tree cover | spec; entitlement unknown (peer got 403 on the OGC `properties` collections) | Building footprint for the massing (VX instead of HAND trace) | P1 (one try) |
| V9 | `GET /3d/tileset?layer=3d-cities` | Photogrammetric mesh as 3D Tiles | spec; peer says `/3d/collections` lists Houston 2023 for the hackathon key | Real exterior in three.js via a 3D Tiles renderer | later (L) |
| V10 | `GET/POST /embedding/extract` | Visual similarity search by text, image or location | spec | Gimmick ("find other entrances that look like this"); skip tonight | later |
| V11 | Vexcel MCP `https://api.vexcelgroup.com/v2/mcp` | Same products as tools for an agent | marketing page (https://vexceldata.com/?p=26742) | Agent depth: site_investigator calls Vexcel itself | later |

What is **not** in our reach tonight:

* A ready made layer of curbs, sidewalks, curb ramps or accessible stalls. Vexcel's Roadways product
  covers street infrastructure and markings ("curb mats, pedestrian islands, and roundabouts"; "symbols,
  arrows, text, stop bars, crosswalks, and bicycle lanes", https://vexceldata.com/?p=9472), aimed at
  public roads, and is not known to be on the hackathon key. Private parking lot details have to come from
  open vocabulary detection (V7) or a human.
* Step accurate curb heights. Vexcel's urban DSM is sold at 5.5 to 7.5 cm with 15 cm absolute vertical
  RMSE; the 15 to 20 cm products have 1 m RMSE (https://docs.up42.com/data/vexcel-elevate). A curb is about
  15 cm. Absolute error equals the thing we want to measure; relative error between two points 5 m apart
  is probably smaller but is **unverified**, and a parked car or a person at capture time puts a 1.5 m bump
  in the profile. Rule (keeps agent2 V6): never assert a step from the DSM. Say "the aerial height map
  suggests a small rise here (possibly)" only if the jump is over 0.10 m and lies within 1 m of the line
  where the ortho shows the aisle meeting the sidewalk.

### 1.2 Calls, exactly

All WKT is lon lat order. Build boxes as squares **in metres**, not in degrees (at 30 N a degree of
longitude is only 0.866 of a degree of latitude, so a degree square ortho is stretched).

Metres per degree near the clinic (spherical, error under 0.5%, about 3 cm over the 7.5 m walk):
`m_per_deg_lat = 111319.5`, `m_per_deg_lon = 96437.9`.

80 m box (half 40 m) around the model point:
```
POLYGON((-95.5398191 29.9662852, -95.5389895 29.9662852, -95.5389895 29.9670038, -95.5398191 29.9670038, -95.5398191 29.9662852))
```
Better: centre the box on the midpoint of the curb and door pins, not the model point (the model
lat/lon may be the parcel centroid or a geocode).

**V1 ortho (working):**
```http
POST /v2/ortho/extract
{"wkt":"POLYGON((...80 m box...))","srid":4326,"layer":"urban,urban-r,wide-area,urban-g",
 "crop":"bounding_box","image-format":"jpeg","destination-dimensions":"1067,1067","attribution":"false"}
```
1067 px over 80 m is 7.5 cm per pixel (native); 1400 px over 80 m upsamples to 5.7 cm and only costs bytes.
Save the exact WKT next to the image (`arrival_ortho.json`), the scene needs it to georeference the texture.

**V3 probe (one call, do first):**
```http
GET /v2/oriented/collections?wkt=POINT(-95.5394043 29.9666445)&srid=4326&layer=urban&product-type=all
```
If the answer has oblique product types, go on to V2.

**V2 oblique of the entrance:**
```http
GET /v2/oriented/extract?layer=urban&wkt=POINT(<door_lon> <door_lat>)&srid=4326&buffer-meter=30
    &product-type=oblique-north&image-format=png&rotation=natural
    &crosshair=POINT(<door_lon> <door_lat>)&crosshair-color=rgb(255,198,41)&crosshair-line-width=4
```
* Parameters from the spec: `product-type` one of `nadir` (default), `oblique-north`, `oblique-south`,
  `oblique-west`, `oblique-east`; `rotation` `natural` is the default for obliques; JPEG stores rotation
  only in EXIF, PNG has it applied, so ask for PNG; `crosshair` is "a point for a crosshair reticle"
  (value format **unverified**, try `POINT(lon lat)` first); `crosshair-color` default `rgb(255,200,0)`.
* Which direction shows a southwest facade: Vexcel's spec does not say whether `oblique-north` means
  "camera looking north" or "north face". **Unverified.** Fetch all four (4 small calls), keep the one where
  the canopy is visible, and write the answer into APIS.md for the next person.
* Colour: `rgb(255,198,41)` is our detectable yellow `#FFC629`, so the reticle reads as "placed by a person".

**V5 height profile along the walk (cheap, no TIFF parsing):**
```http
GET /v2/dsm/elevation?layer=urban&srid=4326&unit-system=metric
    &wkt=LINESTRING(<curb_lon> <curb_lat>, <p1>, <p2>, ..., <door_lon> <door_lat>)
```
Densify the line yourself every 0.25 m (about 31 vertices for 7.5 m): the spec says it returns the
input WKT with Z added, so it probably samples only the vertices you send (**unverified**). Also send a
second line that continues 4 m past the door into the building footprint (roof height) and a point grid
3 m around the door (canopy).

**V6 DSM tile, if you want building height and canopy from pixels:**
```http
GET /v2/dsm/extract?layer=urban&wkt=POLYGON((...40 m box...))&srid=4326
```
Returns `image/tiff`, "Each pixel will have an elevation value in meters (over the EGM2008 geoid)"; if
`zoom` is omitted the service uses the highest zoom that stays at or under 1,024 tiles. Read with
`tifffile` or `rasterio` in the engine. Building height = p90 inside footprint minus p20 of the parking
area. Canopy = connected area next to the facade near the door that sits 2.4 to 5 m above ground.

**V7 detection (peer verified body):**
```http
POST /v2/elements/detect
{"wkt":"POINT (<mid_lon> <mid_lat>)","bbox-dimensions":[60,60],
 "images":[{"endpoint":"oriented/extract","request":{"layer":"urban","wkt":"POINT (<mid_lon> <mid_lat>)","bbox-dimensions":"60,60"}}],
 "model-input":{"elements":[
   {"label":"car","detection-threshold":0.5},
   {"label":"parking space","detection-threshold":0.4},
   {"label":"wheelchair parking symbol","detection-threshold":0.4},
   {"label":"tree","detection-threshold":0.5},
   {"label":"light pole","detection-threshold":0.4},
   {"label":"bollard","detection-threshold":0.4},
   {"label":"curb ramp","detection-threshold":0.4},
   {"label":"entrance canopy","detection-threshold":0.4}],
  "include":["geometry","confidence","bbox"]}}
```
Response features are GeoJSON polygons that are 5 point lon/lat boxes, with `properties.label` and
`properties.detections[].confidence` (peer probe). Use the box centre as the object position, the box
as its footprint. Quality is unknown for small objects like curb ramps at 7.5 cm: treat every hit as an
`AI` chip and say "possibly" under 0.6, exactly like the indoor landmarks. Vexcel's own page says the
product "returns a segmentation outline of each detected object and a confidence score" and "does not
classify, categorize, or assess condition" (https://vexceldata.com/intelligence/elements/custom/).
Cache the response; the detection product may be metered.

**V8 footprint (one try):**
```http
GET /v2/property/extract?wkt=POINT(<lon> <lat>)&srid=4326&layer=urban&include=precomputed&unit-system=metric
```
Look for `structures[].footprint.wkt` and `parcel-wkt`. The fields are residential flavoured (pools,
trampolines, decks), coverage of a commercial medical office is **unknown**. On 403 or empty, fall back to
a HAND trace of 4 to 8 corners on the ortho (2 minutes in pick.html) or the CoStar frontage plus the
Matterport outline (section 4.1).

---

## 2. Orientation and mobility: what the outdoor rehearsal must respect

Distilled rules, each with its source, then what it means for us.

1. **Drivers are not guides.** Mississippi State NRTC's ride hailing brief: "Drivers are not required
   to assist you to or from the vehicle"; ask the driver for "information and directions about where to
   find the entrance to the building"; ride hailing firms "may have specific drop-off and pickup points
   at some locations"
   (https://www.blind.msstate.edu/sites/www.blind.msstate.edu/files/2025-07/Ride%20Hailing%20Services%20A%20Few%20Things%20You%20May%20Not%20Know%20revised%202025-5-12.pdf).
   *For us:* the driver message (Task 15) must name the exact spot ("the striped aisle beside the
   accessible parking, at the southwest entrance under the canopy"), and the rehearsal must work even
   if the driver stops somewhere else (recovery lines, day of visit beacon).
2. **Finding the right door is the hardest part of the last few metres.** Microsoft Research's
   formative study (N=22) found locating the intended doorway was the top problem (11 participants),
   caused by GPS error, inaccessible signage, clusters of doors and drop offs far from the destination;
   people asked passers by, used sounds and "feeling around until you find the actual handle"; they most
   wanted the layout of indoor and outdoor spaces (Landmark AI, ASSETS 2019,
   https://microsoft.com/en-us/research/uploads/prod/2019/07/LandmarkAIASSETS.pdf; project page
   https://microsoft.com/en-us/research/?p=599352). *For us:* the outdoor stretch is not a detail, it is
   the documented hard part. Say which door, what is next to it, and what the wrong doors are.
3. **Ask "what would I hit if I turned wrong".** APH ConnectCenter: "You want to know what landmarks you
   can run across, especially if you turn incorrectly", and "Does traffic on the right mean I've turned
   down the wrong street?"; "have your tour guide explain if the building has multiple entrances, which
   can confuse you"; recording a helper's description and reviewing it before the trip helps
   (https://aphconnectcenter.org/?p=61289). *For us:* every outdoor line set includes recovery lines
   computed from geometry (section 4.1.6). This is our cheapest high value idea.
4. **Traffic is an alignment cue and a hazard.** Sauerburger teaches alignment by traffic sound
   ("listen to where the traffic is loudest" and turn so it is at your side), sound shadows from objects
   between you and the traffic, and that traffic sounds differ by time of day
   (https://sauerburger.org/hearing.htm). NFB: blind people use engine sound "to determine the direction,
   speed, and pattern of traffic", including to decide when to cross "a driveway or parking lot", and
   quiet vehicles undermine this (https://nfb.org/node/6156). *For us:* place a simulated traffic bed on
   the real road side (CoStar frontage line) so the person rehearses "traffic behind me and to my left";
   label it `simulated`; warn that parking lot cars can be silent.
5. **Shorelines, trailing, squaring off, sound shadow, drop offs** are the O&M vocabulary (Colorado
   Department of Education O&M glossary: shoreline "A line formed by the meeting of two surfaces";
   squaring off "Placing one's backside against an object in order to obtain a perpendicular line of
   direction"; sound shadow "An object in the environment which is between the sound and the traveler";
   drop off "A step down such as a curb or stair"; recovery "The process of reorienting one's self",
   https://www.cde.state.co.us/sites/default/files/documents/cdesped/download/pdf/om_glossary.pdf).
   *For us:* use these real techniques in the lines ("trail the building wall to your right") and use
   a canopy and a facade as sound shadows in the audio.
6. **Parking lots are open areas.** No shoreline across a lot, cars move in and out. NFB's cane column
   suggests keeping track of a reference point such as a parked car and notes tall landmarks like "parked
   cars" help where usual landmarks vanish (https://nfb.org/node/8558). *For us:* if the path crosses a
   drive lane, the rehearsal stops the traveller at the lane edge and says "cars drive here; stop and
   listen before you cross". Whether the path crosses a lane is a HAND yes/no (we cannot know from
   geometry with confidence).
7. **What the ADA promises about this place, and what it does not.**
   * Site arrival points: "At least one accessible route must be provided within the site to accessible
     facility entrances from these site arrival points" (parking, passenger loading zones, public
     sidewalks, transit stops); "Accessible routes must connect to access aisles serving accessible
     parking spaces and accessible passenger loading zones"; running slope max 1:20, cross slope max 1:48;
     changes in level over 1/2 inch need a ramp or curb ramp (Access Board guide, chapter 4 accessible
     routes, https://www.access-board.gov/ada/guides/chapter-4-accessible-routes/).
   * Accessible parking: aisles at least 60 inches wide (vans need 3 ft more), marked to discourage
     parking; "Accessible routes must connect directly to access aisles"; "Curb ramps, where provided,
     cannot protrude into access aisles"; accessible spaces sit on the shortest accessible route to an
     accessible entrance (https://www.access-board.gov/ada/guides/chapter-5-parking/).
   * Passenger loading zones are required at medical care facilities only where the stay exceeds 24
     hours (https://www.access-board.gov/ada/guides/chapter-5-passenger-loading-zones). A medical office
     is not required to have one; our "drop off" is an access aisle, which is the realistic case.
   * **Detectable warnings (truncated domes) are not required at curb ramps on private sites under the
     DOJ 2010 Standards**: the Access Board says they are "not required at non-transit facilities subject
     to DOJ's Standards"; PROWAG covers public streets
     (https://www.access-board.gov/ada/guides/chapter-4-ramps-and-curb-ramps/). Texas TAS 2012 section 406
     runs 406.1 to 406.7 with no detectable warning provision (https://www.tdlr.texas.gov/AB/2012abtas4.htm).
     *For us: never promise "you will feel bumps" at the aisle edge.* Say "the ground changes where the
     aisle meets the walkway: check with your cane" unless a person confirmed domes.
   * Protruding objects: leading edges at or below 27 inches are cane detectable; 80 inch headroom on
     circulation paths; post mounted objects between 27 and 80 inches may protrude at most 12 inches
     (https://www.access-board.gov/ada/guides/chapter-3-protruding-objects). *For us:* canopy posts,
     sign posts and planters at the door are the real cane level objects; ask the HAND reviewer about
     posts under the canopy.
   * We do not audit compliance. The scene says what we measured; it never says "this entrance is compliant".

---

## 3. Phone positioning reality

### 3.1 Numbers

* GPS on phones: about ±5 m at best, worse in urban canyons (Landmark AI paper, above). A measured
  urban campus study with an iPhone 6 in GPS only mode found RMSE about 9.9 m (range of conditions 7.4
  to 13.0 m), single fixes up to 99.7 m, and error correlated with building cover
  (https://pmc.ncbi.nlm.nih.gov/articles/PMC6638960/). Newer dual frequency phones do better in open sky;
  next to a one storey building with a canopy, plan for 5 to 15 m.
* Soundscape (open source Android successor) is explicit: "Your phone cannot find your position more
  exactly than that, so use your other skills for the last few steps", and "When you are about 40 feet
  away, Soundscape tells you and removes the beacon"
  (https://scottish-tech-army.github.io/Soundscape-Android/users/help-frequently-asked-questions.html).
  40 ft is 12 m. **Our entire curb to door walk is 7.5 m.** A Soundscape style beacon would announce
  arrival while the person is still standing at the car.
* Web Geolocation: `coords.accuracy` is "the accuracy, with a 68% confidence level ... expressed in
  meters" (https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/accuracy). So the
  true position is outside the reported circle about one time in three. Use `2 * accuracy` as the
  "probably within" radius when deciding what to say.
* Compass in a web app:
  * iOS Safari: `DeviceOrientationEvent.requestPermission()` must be called from a tap and resolves
    "granted" or "denied"; HTTPS only. `webkitCompassHeading` gives degrees from north and
    `webkitCompassAccuracy` the plus or minus deviation, "usually 10"
    (https://developer.mozilla.org/docs/Web/API/DeviceOrientationEvent). A negative accuracy means not
    calibrated (**unverified**, widely reported).
  * Android Chrome: listen to `deviceorientationabsolute`; it is supported on Chrome, Firefox, Samsung
    Internet for Android and not on iOS Safari (https://docs.w3cub.com/dom/window/deviceorientationabsolute_event).
    Heading for a phone held flat in portrait: `(360 - alpha) % 360` (**unverified** sign convention per
    device; test against a known bearing).
  * Magnetometers are disturbed by cars and steel (a parking lot is the worst case). Soundscape notes the
    beacon "plays as if you were facing away" when you stop, and recommends to "hold your phone flat"
    (same FAQ). Houston magnetic declination is a few degrees and is smaller than compass noise; ignore it.
* Indoors: no GPS fix worth using, and Matterport gives no positioning. Indoor guidance on the day is
  self paced (the person taps "next line").

### 3.2 What a beacon looks like in the apps people already use

* Soundscape: the beacon is "a steady drumbeat in the direction of the location of the beacon", it
  moves in the stereo field as you turn, "If you are facing the beacon's direction ... a steady beep will
  play along with the beat", and distance comes by voice, not by loudness (AFB AccessWorld review,
  https://afb.org/aw/19/8/15067). When the phone has no direction, the beacon gets quieter
  (https://scottish-tech-army.github.io/Soundscape-Android/users/how-it-works.html).
* BlindSquare announces places by clock direction and distance (AppleVis community, not an official
  source; **unverified** detail). Clock face direction is the common idiom; we already use it indoors.
* Apple Magnifier Door Detection (iPhone and iPad Pro models) announces a nearby door, its distance, how
  to open it and signs near it, and Apple warns "Don't use Door Detection for navigation or in
  circumstances where you could be harmed or injured"
  (https://support.apple.com/guide/ipad/detect-doors-around-you-ipada6aa0d75/16.0/ipados). Worth a line in
  the day of visit screen: "On an iPhone Pro, Magnifier's Door Detection can help with the last steps."
* Be My Eyes: free, a sighted volunteer sees a "live one-way video (two-way audio)", average wait under
  10 seconds (https://support.bemyeyes.com/hc/en-us/articles/360005528557-Getting-started-with-Be-My-Eyes).

### 3.3 Verdict: what we can promise, and what we must not

| We can promise (with the beacon and the rehearsal) | We must not promise |
|---|---|
| "You are at the Medical Office" when the GPS circle overlaps the parcel | Step by step guidance on the 11 steps |
| "The entrance is about 10 m away, roughly at 2 o'clock" **only if** the fix is clearly more than about 15 m from the door, and the compass reports accuracy under about 25 degrees | That the curb, ramp, kerb edge or drive lane is at a given step |
| "You seem to be on the far side of the building; the entrance is behind it, about 40 m" (a wrong drop off is big enough to see) | That there are no cars, people or obstacles |
| The same lines you rehearsed, replayed on demand | Detectable warnings, automatic doors or a canopy, unless a person confirmed them |
| A one tap call to the clinic desk or a sighted helper, and a message with your location | Any indoor position, ever |

Wording rule: distance spoken rounded to 5 m and prefixed "about"; under 15 m say "you are close to the
entrance, within what your phone can measure" and switch to the rehearsed lines.

---

## 4. Design

### 4.1 Rehearsal: the outdoor scene (curb to door)

#### 4.1.1 One frame, curb to desk

Everything lives in the **plan frame** (Matterport metres) that the interior scene already uses. The
outdoor objects arrive in lat/lon (pins, ortho box, detections, frontage) and go through one transform.
Then the fly from curb into the building is a camera move, not a scene swap. That continuity is the
judge moment: "the parking lot photo and the Matterport scan are in one coordinate frame".

**Geo anchor** (`frames.geo_anchor` from plan.md v2: `{lat, lon, plan_pos, plan_north_deg}`):

* `lat, lon` = the door pin (HAND).
* `plan_pos` = the interior entrance position from `overrides.json` `entrance.pos` (HAND on MP).
* `plan_north_deg` = the direction of true north in the plan, in degrees **counterclockwise from plan
  +x**. Derive it from one edge seen in both frames: the entrance wall in plan has direction angle
  `alpha` (counterclockwise from +x); the same facade edge outdoors has compass bearing `beta`
  (clockwise from north) from the CoStar frontage LineString, the Vexcel footprint, or a HAND line on
  the ortho. Then `plan_north_deg = alpha + beta` (mod 360). Resolve the 180 degree ambiguity of an
  edge by requiring the curb pin to land **outside** the building after the transform, in front of the
  entrance (test below).
* If lane B already fixed another convention for `plan_north_deg`, keep theirs and change only the two
  functions below; the tests catch the mismatch.

Transforms (`web/src/geo/frame.ts`, mirror in `engine/dr/geo.py`):

```ts
export interface GeoAnchor { lat: number; lon: number; plan_pos: [number, number]; plan_north_deg: number; mirror?: boolean }
const R = 6378137, D2R = Math.PI / 180;

export function geoToEN(a: GeoAnchor, lat: number, lon: number) {
  return { e: (lon - a.lon) * D2R * R * Math.cos(a.lat * D2R), n: (lat - a.lat) * D2R * R };
}
export function enToPlan(a: GeoAnchor, e: number, n: number): [number, number] {
  const t = a.plan_north_deg * D2R, s = a.mirror ? -1 : 1;
  return [a.plan_pos[0] + s * e * Math.sin(t) + n * Math.cos(t),
          a.plan_pos[1] - s * e * Math.cos(t) + n * Math.sin(t)];
}
export function planToEN(a: GeoAnchor, x: number, y: number) {
  const t = a.plan_north_deg * D2R, s = a.mirror ? -1 : 1, dx = x - a.plan_pos[0], dy = y - a.plan_pos[1];
  return { e: s * (dx * Math.sin(t) - dy * Math.cos(t)), n: dx * Math.cos(t) + dy * Math.sin(t) };
}
export const geoToPlan = (a: GeoAnchor, lat: number, lon: number) => { const { e, n } = geoToEN(a, lat, lon); return enToPlan(a, e, n); };
export const bearingDeg = (e: number, n: number) => (Math.atan2(e, n) / D2R + 360) % 360;   // compass, clockwise from north
export function clockOf(bearingTarget: number, bearingFacing: number) {                     // 12, 1, ... 11
  const rel = (bearingTarget - bearingFacing + 360) % 360; const h = Math.round(rel / 30) % 12; return h === 0 ? 12 : h;
}
```

Derivation check: north (e=0, n=1) maps to plan `(cos t, sin t)`, the angle `t`. East maps to
`(sin t, -cos t)`, 90 degrees clockwise of north, which is right for a plan whose y axis points up on
screen. If the plan's y axis points down (image style), set `mirror: true`; the "curb lands outside"
test tells you which.

Plan to three.js world: reuse the interior's `planToWorld`. If none exists yet, use
`(x, y) -> new Vector3(x, 0, -y)` (plan up on screen becomes three.js -Z, viewed from +Y).

Tests (engine and web, 15 min):
* `test_roundtrip`: geo to plan to geo under 1 cm for points within 100 m.
* `test_door_is_anchor`: `geoToPlan(door)` equals `entrance.pos`.
* `test_curb_outside`: curb maps to a cell outside the building outline (or outside the occupancy grid
  bounds), and `|plan(curb) - plan(door)|` equals the haversine distance within 5 cm.
* `test_hand_description`: the computed script for the demo pins says "about 11 steps" and "1 o'clock"
  for the stored reference heading. If not, the human's description and the geometry disagree: show it
  in the trace, do not silently pick one.

#### 4.1.2 Package additions (`Arrival`, optional fields, defaults keep Task 15 tests green)

```ts
interface ArrivalCue { id: string; kind: "traffic"|"lot"|"edge"|"canopy"|"door"|"post"|"tree"|"car";
  plan: [number, number][];            // point (1 vertex), line or polygon in the plan frame
  prov: Prov; line?: string; }         // spoken text, if any
interface Arrival {                    // existing: lat, lon, entrance_side, dropoff, driver_message, image_url, confirmed
  curb_plan?: [number, number]; door_plan?: [number, number];
  reference_bearing_deg?: number;      // facing direction the clock is relative to (HAND or CALC)
  reference_words?: string;            // "with the car beside you and the building ahead"
  walk_m?: number; steps?: number; clock?: number;
  crosses_drive_lane?: boolean | null; // HAND, null = unknown
  edge_type?: "flush"|"curb_ramp"|"step_up"|"unknown";   // HAND, default unknown
  door_type?: "automatic_sliding"|"automatic_swing"|"push"|"pull"|"unknown";  // AI from pano or HAND
  canopy_plan?: [number, number][];    // polygon, HAND or VX DSM
  building_outline_plan?: [number, number][]; building_height_m?: number;
  ortho?: { url: string; wkt: string; corners_plan: [number, number][] };  // SW, SE, NE, NW
  oblique?: { url: string; product_type: string; capture_date: string } | null;
  cues: ArrivalCue[]; lines: string[]; recovery: string[]; }
```
Prov keys: `arrival.curb` HAND, `arrival.door` HAND, `arrival.walk_m` CALC(HAND), `arrival.clock`
CALC(HAND), `arrival.ortho` VX, `arrival.oblique` VX, `arrival.cue.traffic` CS (frontage) plus
`simulated` (the sound), `arrival.cue.car.*` AI(VX), `arrival.building_height_m` VX or CS or assumed.

#### 4.1.3 Scene composition (three.js, `web/src/scene/outdoor.ts`)

Order and style follow UI_DESIGN line rules (solid measured, dotted AI, dashed assumed, yellow HAND).

1. **Ground quad with the ortho.** Transform the ortho box corners (SW, SE, NE, NW in lon/lat from the
   saved WKT) with `geoToPlan`, then `planToWorld`. Build a `BufferGeometry` quad from those 4 points
   with UVs SW (0,0), SE (1,0), NE (1,1), NW (0,1) (texture `flipY` default, image north up). Put it at
   y = -0.02 so it never fights the interior floor. `texture.colorSpace = THREE.SRGBColorSpace`,
   `anisotropy = renderer.capabilities.getMaxAnisotropy()`. Using the 4 transformed corners (not a
   rotated `PlaneGeometry`) makes rotation, mirror and scale errors visible at once. Validate by eye: the
   striped access aisle in the photo must sit under the yellow curb pin. If it is off by a metre or two,
   that is pin error, fine; if it is off by 10 m or mirrored, the frame is wrong.
2. **Building massing.** Preference: Vexcel `footprint.wkt` (VX) if V8 answers; else a HAND trace on
   the ortho (HAND); else the Matterport outline: union of room polygons buffered 0.3 m (shapely in the
   engine: `unary_union(polys).buffer(0.3).buffer(-0.1).exterior`) (MP). Caveat: 7440 Cypress Creek Pkwy
   and 7400 FM 1960 W may be one multi tenant building; the scan may be one suite, so label the MP outline
   "suite from the scan". `ExtrudeGeometry` to `building_height_m` (VX DSM, else CoStar floors x 4 m
   `assumed`, else 4.5 m `assumed`), `MeshStandardMaterial({ color: ink, transparent: true, opacity:
   0.18, depthWrite: false })`, roof hidden (cutaway) so the interior walls show through. Edges with
   `EdgesGeometry` 2 px ink (solid if VX or MP, dashed if HAND trace of an unseen side).
3. **Canopy.** Polygon from `canopy_plan` (HAND rectangle on the ortho; VX if the DSM finds it), a 0.15 m
   slab at y = 3.0 m (or the DSM height), opacity 0.35, dashed outline when its size is assumed.
4. **Pins.** Drop off: yellow `#FFC629` disc (cylinder r 0.4 m, h 0.06) with a 4 px ink ring and a label
   sprite "Drop off HAND". Door: yellow square tile under the canopy, ink outline, label "Entrance HAND".
5. **Path.** `Line2` (three/examples/jsm/lines) from curb to door, route blue `#2160A8`, 8 px with a 3 px
   white casing, solid (CALC from HAND pins). Step ticks every 0.7 m (11 small ink dots) so judges can
   count steps.
6. **Cues.** Traffic: an amber line along the CoStar frontage offset 8 m away from the building, with a
   small speaker glyph and the `simulated` hatch tag. Parked cars, trees, poles from V7: dotted orange
   rings at the box centres (AI), "possibly" under 0.6. Edge line (aisle meets walkway): a short ink
   line across the path at the HAND point, hatch if `edge_type` is unknown. Drive lane (if
   `crosses_drive_lane`): a translucent orange band.
7. **GPS circle** (P1, 15 min): a `RingGeometry(9.8, 10, 96)` around the drop off, diagonal hatch,
   label "A phone's GPS is typically off by about 10 m here. The whole walk is 7.5 m." This is the one
   picture that explains why rehearsal beats live navigation.
8. **Traveller.** Same yellow disc with ink ring and heading wedge as the observer view, at y = 0.05.
9. **Cameras.** Judge camera: start at 45 m altitude above the drop off looking down (reads as the
   aerial photo), ease over 4 s to a 35 degree oblique behind the traveller; follow at 12 m. At the door,
   move the camera along the entry heading through the door (2 s), fade the building shell opacity from
   0.18 to 0.06 and hand control to the interior scene. User camera: none required (sound first); the
   phone shows the Step button as today.

#### 4.1.4 Movement model outdoors (keep it simple)

Same step model as inside: Up or Step moves 0.7 m along the heading, Left and Right turn 15 or 30
degrees. Collision: the building outline is a wall (cane tap sound "wall", then the recovery line);
detected cars are obstacles (metallic tap); everything else is open. No occupancy grid needed outdoors
tonight; a polygon test per step is enough (`pointInPolygon`, segment crossing for the edge line).

#### 4.1.5 Audio (Web Audio, same graph as inside)

Listener at the traveller, `listener.positionX/Y/Z` at ear height 1.6 m, forward from the heading.
Every source is a `PannerNode({ panningModel: "HRTF", distanceModel: "inverse", refDistance: 2,
rolloffFactor: 1 })` at a world position computed by the same `planToWorld`.

| Cue | Sound | Placement | Behaviour | Label |
|---|---|---|---|---|
| Traffic bed | Brown noise loop (4 s buffer) through `BiquadFilter` lowpass 700 Hz, gain 0.25; plus pass by events every 4 to 9 s: a 3 s noise swell whose panner position ramps along the road line at 13 m/s (`positionX.linearRampToValueAtTime`) | 3 panners spaced 20 m along the frontage line, 8 m outward | Constant; this is the alignment cue ("traffic behind you, on your left") | CS (where), `simulated` (what it sounds like) |
| Parking lot | Rare engine start or door clunk, gain 0.12 | At a detected car (AI) or 6 m from the path | One every 15 to 30 s; at the drive lane edge the traveller stops and the line "Cars drive here. Stop and listen before you cross." plays | AI or HAND, `simulated` |
| Edge | Two clicks 1.2 kHz, 80 ms apart | At the edge line | When the traveller crosses it, plus the edge line (section 4.1.6) | HAND, CALC |
| Canopy | `ConvolverNode` with a 0.4 s decaying noise impulse, wet gain 0 to 0.35 over 0.5 s; traffic lowpass 700 to 450 Hz (sound shadow) | Polygon test on `canopy_plan` | On entering: "You are under the canopy. The door is ahead." | HAND or VX |
| Door beacon | Soft rhythmic pulse, 2 per second; adds a high tick when the door is within ±15 degrees of the heading (Soundscape style) | Door pin | Always on in Explore, toggled by B in Rehearse; stops within 1 m | HAND |
| Door | Motor hum and slide whoosh, only if `door_type` is automatic | Door pin | Plays on arrival | AI from pano or HAND; else no sound and the line says "Find the handle" |
| Handoff | Outdoor master gain to 0 over 1.5 s; interior room tone and the first interior line start | | "You are inside. Your rehearsal continues in the lobby." | |

Sensory honesty: the traffic and lot sounds are stand ins; say so once in Explore ("Traffic sounds here
are a stand in, placed where the road really is").

#### 4.1.6 The spoken lines (computed, not written by a model)

Generated by `engine/dr/arrival.py` from the pins and HAND fields, then `grounded()` checked.

Reference direction: a clock is meaningless without "relative to what". Store `reference_bearing_deg`
and `reference_words` (HAND, set in pick.html with two taps: stand at the curb pin, tap the direction the
person faces). Default if missing: the axis of the striped aisle pointing toward the building
(perpendicular to the facade), words "facing the building, the car beside you".

Demo building template (numbers from the pins; 7.5 m / 0.7 m = 10.7, spoken as 11):

1. "You are in the striped aisle beside the accessible parking, at the southwest side of the building." (HAND)
2. "Face the building with the car beside you. The entrance is at 1 o'clock, about 11 steps." (CALC from HAND)
3. "Traffic from the main road is behind you." (CALC: bearing from the traveller to the frontage line
   relative to the reference; CS; HAND check)
4. If `crosses_drive_lane`: "After about N steps you reach a lane where cars drive. Stop, listen, then cross." (HAND, CALC)
5. Edge: flush "The walkway is level with the aisle." / curb_ramp "A curb ramp takes you up onto the
   walkway." / step_up "There is a step up onto the walkway." / unknown "The ground changes where the
   aisle meets the walkway. Check with your cane." (HAND; never "bumps" unless confirmed)
6. "You are under the canopy now. The door is straight ahead." (HAND or VX)
7. Door: "The doors slide open by themselves." / "Push the door; the handle is on the right." / unknown
   "Find the door handle with your hand; the door may be heavy." (AI from the entrance pano, HAND)
8. "You are inside. Your rehearsal continues in the lobby." (handoff)

Recovery lines (the APH rule "what would I hit if I turned wrong"), computed:

* Overshoot to the facade: cast the reference heading plus and minus 30 degrees from the curb; where it
  hits the facade, compare with the door position along the facade: "If you touch the building wall
  and find no door, trail the wall to your right about N steps to the entrance."
* Wrong way: if the heading points within 45 degrees of the road line: "If the traffic sound is in front
  of you, you are facing the road. Turn around."
* Lost in the lot: "If you lose the aisle, find a parked car, square off with your back to it, and
  listen for the road behind you." (only if the road is behind at the drop off)
* Other doors: if the facade has other doors within 15 m (HAND or AI from the oblique): "The first door
  you reach on your left is a different suite. Ours is under the canopy."

The pocket summary gets lines 1 to 8 and the recovery lines; the driver message stays as Task 15 plus
"the striped aisle beside the accessible parking".

### 4.2 Day of visit companion (`arrive.html` or an "I'm here" mode on the pocket summary)

Principle: same lines, same voice, same order as rehearsed; the phone adds only what it can honestly
measure.

**Flow**

1. Start screen, spoken and visible: "SecondVisit is a rehearsal aid. Your phone's location is only
   accurate to about 5 to 15 metres, and the compass can be wrong near cars. It cannot see cars, curbs or
   people. Keep using your cane or guide dog." Then one full screen button **I'm here**.
2. In the tap handler (iOS needs these inside a user gesture): `await
   DeviceOrientationEvent.requestPermission?.()`, `await audioCtx.resume()`,
   `navigator.wakeLock?.request("screen")`, `navigator.geolocation.watchPosition(onFix, onErr,
   { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })`.
3. Heading: iOS `e.webkitCompassHeading` and `e.webkitCompassAccuracy`; Android
   `deviceorientationabsolute` with `heading = (360 - e.alpha) % 360` when `e.absolute`. Ask to hold the
   phone flat, top pointing where they walk. If accuracy is negative or over 25 degrees, or no event for
   2 s, say "compass unsure" and drop the beacon to half volume (Soundscape behaviour).
4. Decision on each fix (d = haversine to door, a = `coords.accuracy`, 68%):
   * a > 30 m: "I can't place you well right now." Offer the rehearsed lines and the helper buttons.
   * d > max(15, 2a): beacon on toward the door; speak "The entrance is about {round5(d)} metres, at
     {clock} o'clock" (clock from compass), every 10 s or when d changes by 5 m. If d > 30 m and the
     bearing from the door to you is more than 90 degrees from the entrance side bearing: "You may be on
     the far side of the building."
   * otherwise: "You are close to the entrance, within what your phone can measure. Here are your
     rehearsed steps." Beacon off. Big **Next line** button plays line 1, 2, 3 ... (self paced, no
     positioning claimed). Two finger tap repeats.
5. Inside: the same Next line button walks through the interior lines, self paced.
6. **Call a sighted helper** (always visible, bottom bar): "Call the front desk" (`tel:` the CoStar or
   clinic phone if present, else HAND), "Open Be My Eyes" (instruction text; a deep link scheme is
   **unverified**), "Text my location" (`sms:?&body=` with "I'm at the southwest entrance drop off of
   <name>, <address>. My phone says <lat>,<lon> (about <a> m)."). Add the Door Detection tip for iPhone Pro.
7. **Simulated arrival for the demo** (`?simgps=1`): replays a scripted track of fixes (start 45 m away
   on the wrong side of the building, Gaussian noise 6 m, accuracy 8 to 14 m), with the `simulated` tag
   on screen. Shows the beacon working when far, then the honest handover "within what your phone can
   measure" while the dot is still 7 m from the door. Never demo it as real GPS.

### 4.3 How it shows in the judge facing 3D UI

* **Opening beat (10 s):** top down on the Vexcel ortho with chips `VX` (imagery), the two yellow HAND
  pins, the blue path with 11 step dots. Caption: "Drop off to door: 7.5 m, about 11 steps. Placed by a
  person in 2 minutes; everything else is from the aerial photo and the scan."
* **Ease to oblique**, traveller walks, "They hear" strip shows each line; the traffic glyph pulses with
  the pass bys; under the canopy the slab highlights.
* **Through the door** into the interior: the scan's walls appear in place, same frame. This is the
  shot for the CoStar data use criterion (Vexcel and Matterport fused).
* **Side panel:** the Vexcel oblique with the yellow reticle on the door (`VX`, capture date), and under
  it the GPS circle callout: "Phone GPS here: about 10 m. Why we rehearse instead of navigate."
* **Phone mock (P1):** the day of visit screen running `?simgps=1`, tagged `simulated`.
* Layer meter for arrival: e.g. `VX 4 · MP 1 · CS 1 · HAND 3 · CALC 6 · AI 5`.

---

## 5. Build table (tonight, 23:30 to 05:00 freeze)

| # | Piece | Effort | Priority | Data and chip | Notes for the coding agent |
|---|---|---|---|---|---|
| 1 | Geo frame and transforms | S (40 min) | P0 | HAND door and entrance, CS or VX or HAND edge bearing, CALC | Section 4.1.1 code and 4 tests; write `frames.geo_anchor` in the build; `mirror` flag from the curb outside test |
| 2 | Arrival fields and HAND inputs | S (30 min) | P0 | HAND | Extend `overrides.json` `arrival` with `reference_bearing_deg`, `reference_words`, `edge_type`, `crosses_drive_lane`, `door_type`, `canopy` (4 lon/lat), optional facade line; pick.html gets taps for them |
| 3 | Curb script and recovery lines | S (45 min) | P0 | CALC(HAND), CS | `arrival.py`: `lines`, `recovery`, `steps = round(walk_m / 0.7)`, `clock = clockOf(...)`; `grounded()` on every line; test_hand_description |
| 4 | Outdoor scene | M (90 min) | P0 | VX ortho, HAND pins, MP or HAND outline, CALC | Section 4.1.3 items 1 to 6 and 8 to 9; ortho quad from the saved WKT corners |
| 5 | Outdoor audio and handoff | M (60 min) | P0 | CS road line, HAND, `simulated` | Section 4.1.5; reuse the interior AudioContext, master buses `outdoorBus`, `interiorBus` |
| 6 | Outdoor step model | S (30 min) | P0 | CALC | Section 4.1.4: polygon tests, edge crossing, wall tap triggers recovery line |
| 7 | GPS error circle | S (15 min) | P1 | CALC from published GPS accuracy, labelled typical | Section 4.1.3 item 7 |
| 8 | Vexcel oblique with crosshair | S (30 min) | P1 | VX | V3 probe then V2 four directions; save `oblique.png` and its `product_type`, `capture_date`; side panel |
| 9 | Day of visit page | M (90 min) | P1 | HAND pins, device sensors, `simulated` for the demo | Section 4.2; HTTPS required (Vite `--https` or the deployed URL); test on one iPhone and one Android |
| 10 | DSM profile and heights | S to M (45 min) | P1 | VX | V5 densified LINESTRING; V6 only if building height is needed; rule for "possibly a small rise" |
| 11 | Detection hazards | M (45 min) | P1 or later | AI(VX) | V7 body; boxes to plan; dotted rings; cars as obstacles in the step model |
| 12 | Door type from the entrance pano | S (20 min) | P1 | AI(MP) | Annotator `look()` on the pano nearest `entrance.pos`, prompt "is this entrance door automatic sliding, automatic swing, push or pull"; confidence; HAND can override |
| 13 | Vexcel footprint | S (15 min to try) | P1 | VX | V8 one call; on 403 keep HAND or MP outline |
| 14 | Vexcel 3D mesh | L | later | VX | `/3d/tileset?layer=3d-cities`, 3D Tiles renderer in three.js; only after the demo is safe |
| 15 | Vexcel MCP tool for the agent | M | later | VX | site_investigator gets `vexcel_*` tools; good for agent depth after Sunday |

Total P0 about 5 hours of one person, or 2.5 hours split between lanes A (1 to 3) and C (4 to 6).

---

## 6. Risks and honesty labels

| Risk | Mitigation |
|---|---|
| Ortho mis registered or the frame mirrored | 4 corner quad plus the "curb lands outside" test; eyeball the aisle stripes under the pin |
| Model lat/lon is not the building (geocode or parcel centroid) | Centre the ortho on the pin midpoint; the pins are HAND |
| Oblique direction semantics unknown | Fetch 4, pick by eye, record in APIS.md |
| Detection hallucinates a curb ramp | AI chip, "possibly" under 0.6, never used in a spoken safety line |
| DSM noise read as a step | Rule in 1.1; edge line comes from HAND |
| Judges ask "does this replace a cane?" | Said out loud: no. The day of visit screen says it first |
| Day of visit demoed far from Houston | `?simgps=1` with the `simulated` tag |
| Vexcel imagery licence | Keep `arrival_ortho.jpg` and `oblique.png` out of the public repo, show "Imagery © Vexcel" (agent2) |

---

## 7. Three best ideas

1. **Recovery lines from geometry.** "If you touch a wall with no door, trail it to your right about 4
   steps"; "If traffic is in front of you, turn around." Straight from O&M practice (APH: know what you
   hit if you turn wrong), computed by code, cheap, and it is what a cane traveller actually needs when the
   driver stops 3 m off.
2. **The GPS circle on the parking lot.** One ring, 10 m radius, around a 7.5 m path. It shows judges in
   one second why live GPS cannot do this stretch and why rehearsal can, and it sets up the honest day of
   visit mode.
3. **One frame, curb to desk.** The Vexcel ortho and the Matterport scan share the plan frame through the
   geo anchor, so the camera and the sound walk from the striped aisle under the canopy and through the
   door into the scan without a cut. That is visible proof of fusing two sponsor datasets.

---

## 8. Sources

Vexcel
* API 2.0 documentation note: https://support1.vexceldata.com/knowledge/vexcel-api-2.0-documentation
* Migration guide 1.0 to 2.0: https://vexcel.atlassian.net/wiki/spaces/APIDOCS/pages/3035136040/API+Migration+Guide+from+1.0+to+2.0
* OpenAPI pages: https://api.vexcelgroup.com/v2/api-docs (full), /v2/api-docs/oriented, /v2/api-docs/dsm, /v2/api-docs/property, /v2/api-docs/embedding (elements page did not load from here)
* Elevate DSM and DTM specs (UP42 listing): https://docs.up42.com/data/vexcel-elevate
* Custom Elements: https://vexceldata.com/intelligence/elements/custom/
* Roadways: https://vexceldata.com/?p=9472
* Vexcel MCP: https://vexceldata.com/?p=26742
* Peer evidence, same hackathon: https://github.com/burvy/golden (DESIGN.md; docs/burvy/detect-probe.md)

Orientation and mobility, accessibility
* NRTC ride hailing brief: https://www.blind.msstate.edu/sites/www.blind.msstate.edu/files/2025-07/Ride%20Hailing%20Services%20A%20Few%20Things%20You%20May%20Not%20Know%20revised%202025-5-12.pdf
* Landmark AI, last few metres (ASSETS 2019): https://microsoft.com/en-us/research/uploads/prod/2019/07/LandmarkAIASSETS.pdf and https://microsoft.com/en-us/research/?p=599352
* APH ConnectCenter, Become Your Own O&M Instructor: https://aphconnectcenter.org/?p=61289
* Sauerburger, Teaching the Use of Hearing: https://sauerburger.org/hearing.htm
* NFB, quiet vehicles and pedestrian safety: https://nfb.org/node/6156
* NFB, Care and Feeding of the Long White Cane, places without the usual landmarks: https://nfb.org/node/8558
* Colorado CDE O&M glossary: https://www.cde.state.co.us/sites/default/files/documents/cdesped/download/pdf/om_glossary.pdf
* Access Board guides: accessible routes https://www.access-board.gov/ada/guides/chapter-4-accessible-routes/ ; parking https://www.access-board.gov/ada/guides/chapter-5-parking/ ; passenger loading zones https://www.access-board.gov/ada/guides/chapter-5-passenger-loading-zones ; ramps and curb ramps https://www.access-board.gov/ada/guides/chapter-4-ramps-and-curb-ramps/ ; protruding objects https://www.access-board.gov/ada/guides/chapter-3-protruding-objects
* Texas Accessibility Standards 2012, chapter 4: https://www.tdlr.texas.gov/AB/2012abtas4.htm
* ITE, detectable warnings at the sidewalk to street boundary: https://toolkits.ite.org/uiig/ada.html

Positioning and apps
* Smartphone GPS accuracy in an urban environment (PLOS ONE): https://pmc.ncbi.nlm.nih.gov/articles/PMC6638960/
* MDN GeolocationCoordinates.accuracy: https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/accuracy
* MDN DeviceOrientationEvent: https://developer.mozilla.org/docs/Web/API/DeviceOrientationEvent
* deviceorientationabsolute support: https://docs.w3cub.com/dom/window/deviceorientationabsolute_event
* Soundscape (Android) how it works and FAQ: https://scottish-tech-army.github.io/Soundscape-Android/users/how-it-works.html , https://scottish-tech-army.github.io/Soundscape-Android/users/help-frequently-asked-questions.html
* AFB AccessWorld review of Soundscape: https://afb.org/aw/19/8/15067
* Apple Door Detection: https://support.apple.com/guide/ipad/detect-doors-around-you-ipada6aa0d75/16.0/ipados
* Be My Eyes getting started: https://support.bemyeyes.com/hc/en-us/articles/360005528557-Getting-started-with-Be-My-Eyes
