# AGENTS.md: Matterport data for HackPrinceton 2026

Instructions for a coding agent helping a team build with Matterport data in the CoStar track. Read this, then `matterport_quickstart.py`, which is the working reference for every call below.

## Files here

- `matterport_quickstart.py`: the quickstart as a plain script with `# %%` cells. It is the master copy. Each section stands alone after section 1 (setup) has run.
- `matterport_quickstart.ipynb`: the same, as a notebook for Jupyter or any notebook platform. It is generated from the `.py`; edit the `.py` instead.
- `models_index.csv`: one row per model a hackathon key can see (14,945). Columns: `sid, name, segment, lat, lon, latlon_source, address, city, state, postal_code, internal_id, costar_property_id, homes_listing_id, splat, drone_photos, pano_count, room_count, floor_count, created, original_created, defurnished, ai_summary`. `created` is the date the model was copied into the hackathon org (9-11 Nov 2026 for nearly all), not when it was captured; the API's `model { created }` is that same copy date. `original_created` is the date the original space was created (normally within a day of capture), so use it for "when was this scanned".
- `basemap.json`: Los Angeles and Houston county lines, city limits and primary roads (US Census, lon/lat) for drawing models on a map without tiles.
- `reference/index.html`: the same sections for one model, with every query, a real (trimmed) response and the rendered result.
- `kb/`: the sections as Markdown, for search and question answering.

## Keys and auth

- The keys come from `/costar-keys` in the track Discord. Read them from environment variables or a git-ignored `.env` file. Never hard-code them, print them or commit them; keep them in a git-ignored `.env`.
- **Matterport Model API:** `POST https://api.matterport.com/api/models/graph` with GraphQL JSON. Use HTTP basic auth: `MATTERPORT_API_KEY` is the user name and `MATTERPORT_API_TOKEN` the password.
  - These keys work on production only; qa3 and every other host answer 403 `invalid key/secret`.
  - A model the key can't see answers with a GraphQL error whose code is `not.found`.
- **Vexcel:** header `X-API-KEY: $VEXCEL_API_KEY` on `https://api.vexcelgroup.com/v2/...`. Coverage is Houston and Los Angeles only; elsewhere answers 403.
- **CoStar kit:** one zip for everyone. Its link and password are on the CoStar keys card (`COSTAR_KIT_URL` / `COSTAR_ZIP_PASSWORD`).

## What a hackathon key reaches (tested 11-12 Nov 2026)

| Data | How |
|---|---|
| Address, lat/lon, property type, AI summary | `model(id) { address geolocation propertyClassifications generatedDescription { summary } }`. 13,377 of 14,945 models have a summary, but only 70 of the 232 splat models (`ai_summary` in the index). |
| Panoramas | `panoLocations { id label position skybox(resolution: "2k") { children } }`. Six signed face URLs per pano, in the order up, four sides, down. `4k` also works. |
| Defurnished panoramas | `view(type: "matterport.model.defurnished") { id }`, then query `model(id: <that view id>)` with the same fields. The pano ids are the same. 6,979 models have one, including all 211 residential splat models (`defurnished` in the index). |
| Rooms | `rooms { classifications { label } dimensions(units: metric) { areaFloor width depth height } boundary { edges { id } } }` |
| Walls | `floors { vertices { id position { x y } } edges { id vertices { id } } }`. Metres, in the same frame as the panos. |
| Floor plans | `assets { floorplans(provider: "matterport") { format flags url resolution origin { x y } } }`. JPG/PNG renders and a schematic DXF. `origin` is the image's bottom-left corner in metres; `resolution` is pixels per metre. |
| MatterPak (OBJ mesh + point cloud) | `bundle(id: "mp:matterpak") { availability assets { ... on Resource { filename url } } }`. Use the bundle: `assets { resources(format: "matterpak") }` says `unavailable` for hackathon keys even where the bundle has a link. A zip holding `cloud.xyz` (ASCII `x y z r g b`, metres, Z up), `<uuid>.obj` + textures, and plan renders. Read single members with HTTP range requests (`HttpFile` in section 7) rather than downloading the whole zip. A model whose MatterPak is not ready has no `url`. |
| Splats, sky cubemaps, drone photos | From the hackathon site, not the Model API. `GET <site>/2026-princeton-hackathon/api/models/<sid>` returns the catalog entry (photo file names). `GET <site>/2026-princeton-hackathon/resources/<sid>/<file>` redirects to a signed link that lasts one hour. `<file>` is one of `splat/splat.ply`, `splat/envmap/{px,nx,py,ny,pz,nz}.jpg` or `drone-imagery/<name>`. Only the 232 models with `splat == yes` in the index have these. |
| Vexcel ortho | `POST /v2/ortho/extract` with `{"wkt": <polygon, lon lat order>, "srid": 4326, "layer": "urban,urban-r,wide-area,urban-g", "crop": "bounding_box", "image-format": "jpeg"}`. |

Not available: geographic search in the API (use `models_index.csv`), E57, raw scan files. Mattertags are empty on the models checked.

## Gotchas

- Null fields are left out of responses rather than sent as `null`, so use `.get()`. Paging ends when `nextOffset` is missing.
- Signed links (`?t=...`) expire. Re-query rather than caching URLs.
- **Splat PLYs** are 70-660 MB. Gaussians are stored in no spatial order, so a range request for the first N MB gives a fair sample of the scene. Colour is `0.5 + 0.28209479 * f_dc_*`; opacity is `sigmoid(opacity)`; scales are `exp(scale_*)`. The frame is local, Z up and not north-aligned. The splats have no higher-order SH.
- **DJI photos** keep GPS and gimbal angles in the XMP block within the first 48 KB (`drone-dji:GpsLatitude`, `GimbalYawDegree`, `GimbalPitchDegree`, `RelativeAltitude`).
- **Joining to CoStar (untested):** the kit join in section 7 has not been run with the real zip password yet. Residential models use `homes_listing_id`, which matches the kit's residential listings. Commercial models use `costar_property_id`, from the model's `internalId` when it is numeric. Other `internal_id` prefixes (`Apartments-`, `Loopnet-`) are other listing systems.
- Keep requests modest (well under 10 per second). Everyone shares these keys.

## Help

Use the track channel in Discord or `/ask-costar`. Matterport API docs: https://matterport.github.io/developer-docs/api/. SDK: https://matterport.github.io/developer-docs/overview/
