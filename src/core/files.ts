import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { type FetchLike, HttpError } from "./http.js";

export interface CachedFile {
  path: string;
  /** mtime of the local copy (ms since epoch). */
  updatedAt: number;
  /** Set when the refresh failed and an older local copy is used. */
  refreshError?: string;
}

export interface DownloadOptions {
  url: string;
  path: string;
  maxAgeMs: number;
  userAgent: string;
  fetchFn: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

async function mtime(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/** Downloads a file into the local cache unless a recent enough copy exists. */
export async function ensureCachedFile(options: DownloadOptions): Promise<CachedFile> {
  const now = options.now ?? Date.now;
  const existing = await mtime(options.path);
  if (existing !== null && now() - existing < options.maxAgeMs) {
    return { path: options.path, updatedAt: existing };
  }

  try {
    await download(options);
    return { path: options.path, updatedAt: (await mtime(options.path)) ?? now() };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (existing !== null) return { path: options.path, updatedAt: existing, refreshError: reason };
    throw error;
  }
}

async function download(options: DownloadOptions): Promise<void> {
  await mkdir(dirname(options.path), { recursive: true });
  const response = await options.fetchFn(options.url, {
    headers: { "User-Agent": options.userAgent },
    signal: AbortSignal.timeout(options.timeoutMs ?? 10 * 60_000),
  });
  if (!response.ok || response.body === null) {
    throw new HttpError(`Download of ${options.url} failed with status ${response.status}`, response.status);
  }
  // Write to a temp file first so a broken download never replaces a good copy.
  const temp = `${options.path}.download`;
  try {
    await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), createWriteStream(temp));
    await rename(temp, options.path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** Streams a text file chunk by chunk. */
export async function* readTextChunks(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 20 });
  for await (const chunk of stream) yield chunk as string;
}
