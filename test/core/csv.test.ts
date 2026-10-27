import { describe, expect, it } from "vitest";
import { CsvParser, headerIndex, parseCsv } from "../../src/core/csv.js";

describe("csv", () => {
  it("parses quoted fields, escaped quotes and embedded newlines", () => {
    const text = 'a,b,c\n1,"x, y","say ""hi"""\r\n2,"multi\nline",\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'say "hi"'],
      ["2", "multi\nline", ""],
    ]);
  });

  it("supports single-quote quoting", () => {
    expect(parseCsv("'icao24','reg'\n'3c675a','D-AIZZ'", "'")).toEqual([
      ["icao24", "reg"],
      ["3c675a", "D-AIZZ"],
    ]);
  });

  it("handles chunk boundaries anywhere", () => {
    const text = 'a,"b""c",d\n1,2,3\n';
    const rows: string[][] = [];
    const parser = new CsvParser((row) => rows.push(row));
    for (const char of text) parser.write(char);
    parser.end();
    expect(rows).toEqual([
      ["a", 'b"c', "d"],
      ["1", "2", "3"],
    ]);
  });

  it("looks up columns case-insensitively", () => {
    const index = headerIndex(["icao24", "Registration"]);
    expect(index("registration")).toBe(1);
    expect(index("missing")).toBe(-1);
  });
});
