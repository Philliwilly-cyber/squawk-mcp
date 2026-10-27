export const NOTE_ADSB_COVERAGE =
  "Coverage depends on volunteer ADS-B/MLAT receivers: dense over Europe and North America, sparse over oceans, " +
  "deserts and parts of Africa and Asia. Aircraft at low altitude or far from receivers are often missing.";

export const NOTE_MILITARY =
  "Military, government and some private aircraft often do not transmit ADS-B or are filtered, so they may not appear at all.";

export const NOTE_STATE_VALIDITY =
  "Positions older than 15 s are dropped by OpenSky, and aircraft vanish after 15 s without updates.";

export const NOTE_NIGHTLY_BATCH =
  "OpenSky computes flights in a nightly batch: only flights from the previous day or earlier are available. " +
  "For what is flying right now, use the live tools.";

export const NOTE_ESTIMATED_AIRPORTS =
  "Departure and arrival airports are estimated from ADS-B positions, not taken from airline schedules. " +
  "There are no delays, gates or schedule times.";

export const NOTE_TRACKS_EXPERIMENTAL =
  "The OpenSky tracks endpoint is experimental and may be unavailable at any time. " +
  "Waypoints are a simplified trajectory (at least every 15 min, plus turns, climbs and descents).";

export const NOTE_SQUAWK =
  "A squawk is the code the transponder sends. Emergency codes (7500, 7600, 7700) are not a confirmed situation.";

export const NOTE_DISCRETE_SQUAWK =
  "\"Discrete code assigned by ATC\" means air traffic control gave the flight an individual code to identify it on radar; " +
  "the code itself carries no special meaning. explain_squawk explains any code in detail.";
