# Live fixtures

Responses recorded with `npm run live-check -- --record` from the real OpenSky API and Nominatim
(2026-10-27, around Hamburg, anonymous mode). Each file holds the request URL, status, the
rate-limit headers and the body. No request headers or tokens are recorded.

Aircraft identifiers (icao24, callsign) are replaced with placeholders (`f0xxxx`, `ANONnn`) by
`src/live-check/anonymize.ts`, as the OpenSky data license requires de-identification in anything
published. Positions, altitudes, speeds and squawks are real.
