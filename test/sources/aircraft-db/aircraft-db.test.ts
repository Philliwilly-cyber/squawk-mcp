import { describe, expect, it } from "vitest";
import { parseCsv } from "../../../src/core/csv.js";
import { indexRows } from "../../../src/sources/aircraft-db/aircraft-db.js";

const classic = `icao24,registration,manufacturericao,manufacturername,model,typecode,serialnumber,linenumber,icaoaircrafttype,operator,operatorcallsign,operatoricao,operatoriata,owner,built,categoryDescription
3c675a,D-AIZZ,AIRBUS,Airbus,A320 214,A320,5203,,L2J,Lufthansa,LUFTHANSA,DLH,LH,Private Person,2012-08-01,
3C4B26,D-ABYF,BOEING,Boeing,747-830,B748,37829,,L4J,Lufthansa,LUFTHANSA,DLH,LH,,2013-01-01,Heavy
zzzzzz,BROKEN,,,,,,,,,,,,,,
`;

const quotedSingle = `'icao24','registration','manufacturerName','model','typecode','icaoAircraftClass','operator','operatorCallsign','operatorIcao','owner','built','categoryDescription'
'4b1814','HB-JVE','Embraer','ERJ 190-100 LR','E190','L2J','Helvetic Airways','HELVETIC','OAW','','2008-01-01',''
`;

describe("aircraft database", () => {
  it("indexes the classic export by icao24 and registration", () => {
    const index = indexRows(parseCsv(classic));
    expect(index.size).toBe(2);
    expect(index.byIcao24("3C675A")).toMatchObject({
      registration: "D-AIZZ",
      manufacturer: "Airbus",
      typecode: "A320",
      operator: "Lufthansa",
      icaoAircraftClass: "L2J",
      category: null,
    });
    expect(index.byRegistrationMark("d aizz")?.icao24).toBe("3c675a");
    expect(index.byRegistrationMark("dabyf")?.icao24).toBe("3c4b26");
  });

  it("never exposes the owner column", () => {
    const index = indexRows(parseCsv(classic));
    expect(JSON.stringify(index.byIcao24("3c675a"))).not.toContain("Private Person");
  });

  it("reads the single-quoted export with camelCase headers", () => {
    const index = indexRows(parseCsv(quotedSingle, "'"));
    expect(index.byRegistrationMark("HB-JVE")).toMatchObject({ icao24: "4b1814", model: "ERJ 190-100 LR" });
  });
});
