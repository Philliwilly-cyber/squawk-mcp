# squawk-mcp

> Ask your AI what's flying overhead.

A read-only [MCP](https://modelcontextprotocol.io) server that gives AI assistants live flight data from the
[OpenSky Network](https://opensky-network.org), enriched with aircraft metadata, airport data and geocoding.

```
"What's flying over Hamburg right now?"
"Where is D-AIZZ?"
"What landed at Frankfurt yesterday?"
"Is anyone squawking 7700 over Germany?"
```

Every answer says where the data came from, how old it is (`data_age_seconds`), and what it cannot show.
ADS-B coverage has gaps, military aircraft often do not transmit, and past flights arrive in a nightly batch.
squawk-mcp says so instead of guessing.

## Tools

| Tool | What it does | OpenSky credits |
|---|---|---|
| `flights_overhead` | Live aircraft around a place or coordinates, nearest first, with distance and direction | usually 1 |
| `flights_in_area` | Live aircraft in a bounding box or named region | 1 (larger areas 2-4, opt-in) |
| `aircraft_lookup` | Aircraft by registration, icao24 or callsign: type, operator, live position | 0-4 |
| `aircraft_track` | Trajectory of the current flight or one in the last 30 days (experimental endpoint) | ~4 |
| `aircraft_flight_history` | Flights of an aircraft on a past day | ~30 |
| `airport_traffic` | Past arrivals/departures, or aircraft around the airport right now | ~30 per direction / 1 |
| `airport_info` | Airports by code, name or city, or nearest to a place | 0 |
| `emergency_squawks` | Aircraft squawking 7500 / 7600 / 7700 in a region or worldwide | 1-4 |
| `explain_squawk` | Plain-language explanation of a squawk code | 0 |
| `service_status` | Auth mode, remaining credits, local database state | 0 |

Resource: `squawk://reference/codes`, the squawk code reference as JSON.

All tools are read-only. The only side effect is the local cache.

### Units and times

Altitude in m and ft, speed in km/h and kn, vertical rate in m/s and ft/min. Times in Europe/Berlin with UTC offset
(e.g. `2026-10-23T09:15:00+02:00`). Inputs without an offset are read as Berlin time.

### Result format

```jsonc
{
  "source": ["OpenSky Network REST /states/all", "Nominatim (OpenStreetMap)", "OpenSky aircraft database"],
  "server_time": "2026-10-23T09:15:04+02:00",
  "data_time": "2026-10-23T09:15:00+02:00",
  "data_age_seconds": 4,
  "auth_mode": "oauth2",            // or "anonymous"
  "cache": "fresh",                 // "cached", or "stale" after an upstream failure
  "coverage_notes": ["Coverage depends on volunteer ADS-B/MLAT receivers ..."],
  "warnings": ["DLH4AB is squawking 7700 (General emergency). A squawk is only what the transponder is sending ..."],
  "attribution": ["Flight data: The OpenSky Network ..."],
  "data": { "...": "..." }
}
```

## Setup

Requires Node.js 22.12 or newer.

```sh
git clone https://github.com/philliwilly-cyber/squawk-mcp.git
cd squawk-mcp
npm ci
npm run build
```

### OpenSky credentials (recommended)

Without credentials squawk-mcp runs in anonymous mode: 400 credits per day shared by your IP, latest data only,
10 s resolution. With an account you get 4,000 credits per endpoint group per day and 5 s resolution.

1. Log in at [opensky-network.org](https://opensky-network.org) and open
   [Account](https://opensky-network.org/my-opensky/account).
2. Create an API client and note `client_id` and `client_secret`.
3. Pass them as `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET`.

squawk-mcp uses the OAuth2 client-credentials flow, caches the token and refreshes it before it expires.

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "squawk": {
      "command": "node",
      "args": ["/path/to/squawk-mcp/dist/index.js"],
      "env": {
        "OPENSKY_CLIENT_ID": "your-client-id",
        "OPENSKY_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

With Claude Code: `claude mcp add squawk -e OPENSKY_CLIENT_ID=... -e OPENSKY_CLIENT_SECRET=... -- node /path/to/squawk-mcp/dist/index.js`

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` | - | OpenSky API client; anonymous mode if unset |
| `SQUAWK_CACHE_DIR` | `$XDG_CACHE_HOME/squawk-mcp` or `~/.cache/squawk-mcp` | Downloaded CSVs and the geocoding cache |
| `SQUAWK_CONTACT` | - | Contact (e.g. e-mail) added to the User-Agent, as Nominatim recommends |
| `SQUAWK_AIRCRAFT_DB_URL` | OpenSky aircraft database CSV | Override if the download moves |
| `SQUAWK_AIRPORTS_URL` | OurAirports `airports.csv` | Override the airport data source |
| `SQUAWK_NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Use your own Nominatim instance |
| `OPENSKY_API_URL`, `OPENSKY_TOKEN_URL` | official endpoints | For testing |

## Data sources and limits

- **OpenSky Network REST API**: live state vectors, flights, arrivals/departures, tracks.
  Credits are counted per endpoint group (`/states`, `/flights`, `/tracks`). `/states/all` costs 1 credit for
  areas up to 25 sq°, up to 4 for larger areas or worldwide. Flights and tracks cost 4 (last 24 h) to 30 (1-2 days).
  Flights, arrivals and departures are computed in a **nightly batch**: only yesterday or earlier.
- **OpenSky aircraft database** (CSV): type, manufacturer, operator, registration. Downloaded once, refreshed monthly.
  The `owner` column is deliberately not used, because for private aircraft it often names a person.
- **[OurAirports](https://ourairports.com/data/)** (public domain): airports, refreshed weekly.
- **[Nominatim](https://nominatim.org)** (OpenStreetMap): place names to coordinates, at most one request per second,
  identifying User-Agent, results cached for 30 days, following the
  [usage policy](https://operations.osmfoundation.org/policies/nominatim/).

How squawk-mcp saves credits: small default areas, short caches that match the API's time resolution, identical
requests coalesced, smaller areas answered from a cached larger one, time windows validated before calling the API,
retries with backoff on 429/5xx, and stale cache data (with a warning) when OpenSky is unavailable.

## Terms of use

OpenSky data is for **research and non-commercial use**. See the
[OpenSky terms of use](https://opensky-network.org/about/terms-of-use). Publications using the data should cite:

> Matthias Schäfer, Martin Strohmeier, Vincent Lenders, Ivan Martinovic and Matthias Wilhelm.
> "Bringing Up OpenSky: A Large-scale ADS-B Sensor Network for Research".
> In Proceedings of the 13th IEEE/ACM International Symposium on Information Processing in Sensor Networks (IPSN),
> pages 83-94, April 2014.

OpenSky may block requests from AWS and other cloud providers, so run squawk-mcp on your own machine.
Geocoding results © OpenStreetMap contributors (ODbL).

## Development

```sh
npm run check   # typecheck + lint + tests
npm run build
```

See [CLAUDE.md](CLAUDE.md) for architecture and conventions.
