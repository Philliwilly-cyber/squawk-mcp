/**
 * Streaming CSV parser (RFC 4180 style): quoted fields, doubled quotes as escapes,
 * line breaks inside quotes. The quote character is configurable because some
 * OpenSky aircraft database exports quote with single quotes.
 */
export class CsvParser {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  private pendingQuote = false;

  constructor(
    private readonly onRow: (row: string[]) => void,
    private readonly quote = '"',
    private readonly delimiter = ",",
  ) {}

  write(chunk: string): void {
    for (const char of chunk) {
      if (this.inQuotes) {
        if (this.pendingQuote) {
          this.pendingQuote = false;
          if (char === this.quote) {
            this.field += char;
            continue;
          }
          this.inQuotes = false;
          // fall through: the quote closed the field, handle char normally
        } else if (char === this.quote) {
          this.pendingQuote = true;
          continue;
        } else {
          this.field += char;
          continue;
        }
      }

      if (char === this.quote && this.field === "") {
        this.inQuotes = true;
      } else if (char === this.delimiter) {
        this.endField();
      } else if (char === "\n") {
        this.endRow();
      } else if (char !== "\r") {
        this.field += char;
      }
    }
  }

  end(): void {
    if (this.pendingQuote) {
      this.pendingQuote = false;
      this.inQuotes = false;
    }
    if (this.field !== "" || this.row.length > 0) this.endRow();
  }

  private endField(): void {
    this.row.push(this.field);
    this.field = "";
  }

  private endRow(): void {
    this.endField();
    const row = this.row;
    this.row = [];
    if (!(row.length === 1 && row[0] === "")) this.onRow(row);
  }
}

/** Parses a whole CSV string; mainly for tests and small files. */
export function parseCsv(text: string, quote = '"'): string[][] {
  const rows: string[][] = [];
  const parser = new CsvParser((row) => rows.push(row), quote);
  parser.write(text);
  parser.end();
  return rows;
}

/** Maps header names (case-insensitive) to column indexes. */
export function headerIndex(header: readonly string[]): (name: string) => number {
  const map = new Map(header.map((name, index) => [name.trim().toLowerCase(), index]));
  return (name) => map.get(name.toLowerCase()) ?? -1;
}
