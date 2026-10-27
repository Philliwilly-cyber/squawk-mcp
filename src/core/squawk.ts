/**
 * Plain-language explanations for transponder (Mode A / "squawk") codes.
 *
 * Only codes with an internationally stable meaning get a specific explanation.
 * Everything else is a discrete code assigned by air traffic control, whose
 * meaning depends on the local ATC unit - we say so rather than guess.
 */

export type SquawkCategory = "emergency" | "special" | "conspicuity" | "discrete" | "invalid";

export interface SquawkInfo {
  code: string;
  category: SquawkCategory;
  label: string;
  meaning: string;
  /** Present for emergency codes: what the code does and does not tell us. */
  caveat?: string;
}

export const EMERGENCY_CAVEAT =
  "A squawk is only what the transponder is sending. It does not confirm what is happening on board: " +
  "codes are sometimes set by mistake, briefly while dialling another code, or during maintenance tests. " +
  "Official information comes from the airline, the airport or the authorities.";

interface KnownCode {
  category: SquawkCategory;
  label: string;
  meaning: string;
}

const KNOWN: Readonly<Record<string, KnownCode>> = {
  "7500": {
    category: "emergency",
    label: "Unlawful interference (hijacking)",
    meaning:
      "The crew signals unlawful interference, i.e. a hijacking or a similar threat on board. " +
      "Controllers will usually ask the crew to confirm the code, because 7500 is set by accident more often than it is real.",
  },
  "7600": {
    category: "emergency",
    label: "Radio communication failure",
    meaning:
      "The aircraft has lost two-way radio contact with air traffic control. It follows published lost-communication " +
      "procedures, and ATC keeps other traffic clear. Usually a technical problem, rarely dangerous on its own.",
  },
  "7700": {
    category: "emergency",
    label: "General emergency",
    meaning:
      "The crew has declared an emergency. This covers a wide range: medical emergency on board, technical problem, " +
      "low fuel, smoke, and more. ATC gives the aircraft priority. Many 7700 flights land normally after a precautionary diversion.",
  },
  "7400": {
    category: "special",
    label: "Unmanned aircraft: lost control link",
    meaning:
      "Used by remotely piloted aircraft (drones) when the command and control link to the remote pilot is lost. " +
      "The aircraft then flies a pre-programmed lost-link procedure.",
  },
  "7000": {
    category: "conspicuity",
    label: "VFR conspicuity code (ICAO / Europe)",
    meaning:
      "Standard code for aircraft flying under visual flight rules without an individual code from ATC, " +
      "used in Germany and most of Europe. Typical for light aircraft, gliders with transponders and helicopters.",
  },
  "1200": {
    category: "conspicuity",
    label: "VFR conspicuity code (USA / Canada)",
    meaning:
      "Standard code for VFR flights in the United States, Canada and some other countries. " +
      "Same idea as 7000 in Europe.",
  },
  "2000": {
    category: "conspicuity",
    label: "No code assigned yet",
    meaning:
      "Set when an aircraft enters radar-controlled airspace without an assigned code, e.g. coming from oceanic airspace. " +
      "In some countries it is also the IFR default.",
  },
  "0020": {
    category: "special",
    label: "Air rescue helicopter (Germany)",
    meaning:
      "In Germany, 0020 is allocated to helicopter emergency medical services (HEMS), such as the \"Christoph\" " +
      "rescue helicopters. Other countries may assign it differently.",
  },
  "1000": {
    category: "conspicuity",
    label: "Mode S conspicuity code",
    meaning:
      "Used in parts of Europe for IFR flights that ATC identifies by their Mode S / ADS-B address instead of " +
      "an individual squawk. Normal and unremarkable.",
  },
};

const OCTAL_SQUAWK = /^[0-7]{4}$/;

export function isEmergencySquawk(code: string | null | undefined): boolean {
  return code === "7500" || code === "7600" || code === "7700";
}

export function explainSquawk(raw: string): SquawkInfo {
  const code = raw.trim();
  if (!OCTAL_SQUAWK.test(code)) {
    return {
      code,
      category: "invalid",
      label: "Not a valid squawk code",
      meaning:
        "Squawk codes have exactly four digits, each from 0 to 7 (they are octal, so 8 and 9 never appear). " +
        "That gives 4096 possible codes.",
    };
  }
  const known = KNOWN[code];
  if (known) {
    return known.category === "emergency" ? { code, ...known, caveat: EMERGENCY_CAVEAT } : { code, ...known };
  }
  return {
    code,
    category: "discrete",
    label: "Discrete code assigned by ATC",
    meaning:
      "An individual code that air traffic control assigned to this flight so controllers can identify it on radar. " +
      "It has no special meaning by itself; specific ranges are allocated per country and ATC unit.",
  };
}

/** One-line warning text for a flight squawking an emergency code. */
export function emergencyWarning(code: string, who: string): string {
  const info = explainSquawk(code);
  return `${who} is squawking ${code} (${info.label}). ${EMERGENCY_CAVEAT}`;
}

/** Reference table for all codes with a specific meaning, for the squawk resource. */
export function squawkReference(): SquawkInfo[] {
  return Object.keys(KNOWN).map((code) => explainSquawk(code));
}
