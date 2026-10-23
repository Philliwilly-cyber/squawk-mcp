# squawk-mcp

> Ask your AI what's flying overhead.

A read-only MCP server that gives AI assistants live flight data from the
OpenSky Network, enriched with aircraft metadata, airport data and geocoding.

## Goal

- Answer questions like "What's flying over Hamburg right now?", "Where is
  D-AIZZ?", "What landed at EDDF yesterday?" or "Is anyone squawking 7700
  over Germany?"
- Be honest about data gaps instead of guessing: every result says where the
  data came from, how old it is and what it cannot show.
- Be frugal with the OpenSky credit quota.

## Stack

- TypeScript, Node.js 22+, ESM
- Official `@modelcontextprotocol/sdk`, stdio transport
- Zod for tool input schemas
- Native `fetch` (no HTTP client dependency unless there is a clear need)
- Vitest for tests, ESLint (typescript-eslint, type-aware) for linting

## Architecture

```
src/
  index.ts            entry point: config, wiring, stdio transport
  server.ts           MCP server, tool registration
  config.ts           env parsing (OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET, cache dir, ...)
  tools/              one file per tool; thin: validate input, call services, format result
  sources/
    opensky/          REST client, OAuth2 token manager, credit tracking, response parsing
    aircraft-db/      OpenSky aircraft database CSV: download, local cache, index by icao24/registration
    ourairports/      OurAirports CSV: download, local cache, index by ICAO/IATA/name
    nominatim/        geocoding with 1 req/s throttle, User-Agent, persistent cache
  core/
    cache.ts          TTL cache, stale-on-error fallback
    dedupe.ts         in-flight request coalescing (identical requests share one promise)
    retry.ts          backoff for 429/5xx, honours X-Rate-Limit-Retry-After-Seconds
    envelope.ts       common result envelope (see below)
    units.ts          m/ft, m/s -> km/h and kn, ft/min
    time.ts           Europe/Berlin formatting with offset
    squawk.ts         squawk code explanations
    geo.ts            bounding boxes, distance, bbox area in sq°
test/                 Vitest, mirrors src/; fixtures are recorded API responses
```

Layering: `tools -> sources -> core`. Tools never call `fetch` directly.
Sources never format output for the user.

## Result envelope (every tool)

Every tool result contains, besides its payload:

- `source`: which data source(s) answered (e.g. `OpenSky Network REST /states/all`)
- `server_time`: when squawk-mcp produced the answer (Europe/Berlin, ISO 8601 with offset)
- `data_time`: the time the data refers to (e.g. OpenSky `time`)
- `data_age_seconds`: `server_time - data_time`
- `auth_mode`: `oauth2` or `anonymous`
- `cache`: `fresh` | `cached` | `stale` (stale = served from cache after an upstream failure)
- `coverage_notes`: what the data cannot show (ADS-B coverage gaps, military
  aircraft often not transmitting, nightly-batched flights, ...)
- `warnings`: concrete problems with this answer (anonymous mode, stale data,
  quota low, experimental endpoint, ...)
- `attribution`: OpenSky citation, OSM/Nominatim attribution where used

Units: altitude in m and ft, speed in km/h and kn, vertical rate in m/s and
ft/min. Times in Europe/Berlin with UTC offset (e.g. `2026-10-23T09:15:00+02:00`),
raw Unix timestamps kept alongside where useful.

Squawk codes: whenever a squawk appears in a result, add a plain-language
explanation. 7500 (unlawful interference), 7600 (radio failure) and 7700
(general emergency) are always highlighted and also mentioned in `warnings`.
Phrase emergency codes carefully: a squawk is what the transponder sends,
not a confirmed situation (it can be a mis-set code or a test).

## Data sources

### OpenSky Network REST API

Source of truth for limits: https://openskynetwork.github.io/opensky-api/rest.html
(doc sources: github.com/openskynetwork/opensky-api, `docs/free/`). Re-check when
behaviour looks off; the API changed significantly in 2025/2026.

- Base URL: `https://opensky-network.org/api`
- Auth: OAuth2 client credentials only (basic auth gone since 2026-03-18).
  - Token URL: `https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token`
  - `POST`, `application/x-www-form-urlencoded`, `grant_type=client_credentials`, `client_id`, `client_secret`
  - Send `Authorization: Bearer <token>`
  - Tokens live 30 min (`expires_in`, default 1800 s). Cache the token, refresh
    ~30-60 s before expiry, on `401` refresh once and retry.
  - Credentials from `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`. Never log them.
  - Without credentials: anonymous mode, with a warning in every result.

Endpoints used:

| Endpoint | Purpose | Notes |
|---|---|---|
| `GET /states/all` | live state vectors | `time`, `icao24` (repeatable), `lamin/lomin/lamax/lomax`, `extended=1` for category |
| `GET /states/own` | own receivers | auth required, no credit cost; not used by default |
| `GET /flights/all` | flights in `[begin, end]` | interval max 2 h |
| `GET /flights/aircraft` | flights of one aircraft | interval max 2 days, nightly batch |
| `GET /flights/arrival` | arrivals at an airport (ICAO) | interval max 2 days, nightly batch |
| `GET /flights/departure` | departures from an airport (ICAO) | doc says "must cover more than two days" - almost certainly a typo for "not more than"; treat as max 2 days, verify |
| `GET /tracks` | trajectory of one aircraft | experimental, may be down at any time; `time=0` = live track; max 30 days back. Doc example uses `/tracks/all` - verify which path works |

`/flights/*` return `404` with empty body when nothing was found; that is "no
data", not an error.

State vector array indices: 0 icao24, 1 callsign (padded to 8 chars, trim),
2 origin_country, 3 time_position, 4 last_contact, 5 longitude, 6 latitude,
7 baro_altitude (m), 8 on_ground, 9 velocity (m/s), 10 true_track (°),
11 vertical_rate (m/s), 12 sensors, 13 geo_altitude (m), 14 squawk, 15 spi,
16 position_source (0 ADS-B, 1 ASTERIX, 2 MLAT, 3 FLARM), 17 category (only
with `extended=1`; 0-20, e.g. 2 light, 6 heavy, 8 rotorcraft, 14 UAV).
Rows may be shorter than 18 entries; parse defensively.

Freshness:

- State vectors are live, released once per second; a vehicle disappears after
  15 s without position/velocity updates. Position older than 15 s is omitted.
- Time resolution: anonymous 10 s (`time` parameter ignored, latest only),
  authenticated 5 s and at most 1 h back (older -> `400`).
- `/flights/aircraft` and `/flights/arrival` (and in practice `/departure`) are
  filled by a nightly batch: only the previous day or earlier. Never present
  them as live. For "right now" questions use state vectors.

### API limits and credits

Credits are tracked in three independent daily buckets: `/states/*`,
`/tracks/*`, `/flights/*`. `/states/own` is free.

| Tier | Credits per bucket | Refill |
|---|---|---|
| Anonymous (per IP) | 400 | daily |
| Standard user | 4,000 | daily |
| Active feeder (>=30 % uptime/month) | 8,000 | daily |
| Licensed user | 14,400 | hourly |

`/states/all` cost by bounding box area (lat range x lon range, sq°):

| Area | Credits |
|---|---|
| <= 25 sq° (or serial-only) | 1 |
| 25-100 sq° | 2 |
| 100-400 sq° | 3 |
| > 400 sq° or global | 4 |

`/flights/*` and `/tracks/*` cost by day partitions crossed:
live / < 24 h: 4, 1-2: 30, 3-10: 60 x N, 11-15: 120 x N, 16-20: 240 x N,
21-25: 480 x N, > 25: 960 x N.

Headers: `X-Rate-Limit-Remaining` (balance), on `429`
`X-Rate-Limit-Retry-After-Seconds`. Track the last seen balance per bucket and
surface it (low balance -> warning).

Unclear in the docs, to be measured via `X-Rate-Limit-Remaining`: whether an
`icao24`-only `/states/all` query is billed as global (4) or cheaper.

### Quota rules

- Default to small bounding boxes (<= 25 sq°, i.e. 1 credit). Larger areas only
  on explicit request, with the cost stated in the result.
- Short TTL cache for state vectors (~10 s anonymous, ~5 s authenticated,
  matching the time resolution); longer for flights (hours) and tracks (minutes).
- Coalesce identical in-flight requests; serve a smaller bbox from a cached
  larger one where possible.
- Retry 429/5xx with exponential backoff and jitter, honour the retry-after
  header, cap total wait. Do not retry 4xx other than 401 (once) and 429.
- On upstream failure, serve stale cache data if available, with a warning
  naming its age.
- Never split a flights query into many partitions silently; reject or ask for
  a smaller window.

### Terms of use (OpenSky)

- API is for research and non-commercial purposes; commercial live data needs a
  licence (contact OpenSky). Terms: https://opensky-network.org/about/terms-of-use
- Publications using OpenSky data should cite: Schäfer et al., "Bringing Up
  OpenSky: A Large-scale ADS-B Sensor Network for Research", IPSN 2014.
- OpenSky may block AWS and other hyperscaler IPs: squawk-mcp is meant to run
  locally on the user's machine.
- One account per person (multiple accounts get banned). Do not build anything
  that rotates credentials or IPs to dodge limits.
- OpenSky explicitly asks not to request whitelisting for AI dashboards. Respect it.

### OpenSky Aircraft Database (CSV)

Type, manufacturer, operator, registration by icao24. Download once, cache
locally (e.g. `~/.cache/squawk-mcp/`), refresh at most monthly. Large file:
stream-parse, index icao24 and registration. Exact current download URL and
licence must be verified before implementation. Missing entries are normal;
say "not in database" rather than guessing.

### OurAirports (CSV, public domain)

`airports.csv` (and `runways.csv` if needed) from
https://davidmegginson.github.io/ourairports-data/. Cache locally, refresh at
most weekly. Lookup by ICAO (`gps_code`/`ident`), IATA, name, municipality.

### Nominatim (OSM geocoding)

Usage policy: https://operations.osmfoundation.org/policies/nominatim/

- Max 1 request per second (global throttle in the process, queue the rest)
- Descriptive User-Agent identifying squawk-mcp with a contact/repo URL
- Cache results persistently; no bulk geocoding, no autocomplete
- Attribution: "© OpenStreetMap contributors"

## Coverage notes (state them, don't hide them)

- ADS-B/MLAT coverage depends on volunteer receivers: dense over Europe/US,
  sparse over oceans, deserts, parts of Africa/Asia; low altitude often missing.
- Military and state aircraft often do not transmit ADS-B or are filtered.
- Not every aircraft has a callsign or position; position_source tells how a
  position was derived.
- Flights/arrivals/departures are estimated from ADS-B (airports are guesses,
  see `*CandidatesCount`), not airline schedules. No delays, gates or schedules.

## Conventions

- Strict TypeScript (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`); no `any` without a comment explaining why.
- ESLint must pass; Vitest must pass; no network in unit tests (use fixtures,
  inject `fetch` and clock).
- All tools are read-only (`readOnlyHint: true`), no side effects beyond the local cache.
- Code, docs, comments and commit messages in English.
- Small commits, one logical change each, imperative subject line
  (`Add token manager for OpenSky OAuth2`), body explains why when not obvious.
- The version number lives only in `package.json`. Read it from there at
  runtime; never hard-code it elsewhere (docs, User-Agent, server info).
- Never log secrets or tokens. Logs go to stderr (stdout is the MCP channel).
