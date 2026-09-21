/**
 * Dual audio storage (F11): local disk by default; optional private S3 when S3_ENABLED=true.
 * AI and ffmpeg always use local paths; S3 is the durable store in production.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const FC_RECORDINGS_DIR = path.resolve(
  backendRoot,
  process.env.FC_RECORDINGS_DIR ?? "./data/fc-recordings",
);

let s3Client: S3Client | null = null;

export function isS3Enabled(): boolean {
  const flag = (process.env.S3_ENABLED ?? "").trim().toLowerCase();
  if (!["1", "true", "yes", "on"].includes(flag)) return false;
  return Boolean((process.env.S3_AUDIO_BUCKET ?? "").trim());
}

export function getS3Bucket(): string {
  return (process.env.S3_AUDIO_BUCKET ?? "").trim();
}

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: (process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "ap-south-1").trim(),
    });
  }
  return s3Client;
}

export function recordingFileName(callId: number, recordingId: number, extension: string): string {
  const ext = extension.startsWith(".") ? extension : `.${extension || ".mp3"}`;
  return `fc_${callId}_${recordingId}${ext}`;
}

/** Key layout: recordings/{callDate}/fc_{callId}_{recordingId}{ext} */
export function buildRecordingS3Key(params: {
  callId: number;
  recordingId: number;
  extension: string;
  callDate?: string | null;
}): string {
  const date =
    params.callDate && /^\d{4}-\d{2}-\d{2}$/.test(params.callDate)
      ? params.callDate
      : "unknown-date";
  return `recordings/${date}/${recordingFileName(params.callId, params.recordingId, params.extension)}`;
}

export async function fileExists(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath) return false;
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function hasAudioAvailable(doc: {
  localPath?: string | null;
  s3Key?: string | null;
}): boolean {
  return Boolean(doc.localPath || doc.s3Key);
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function putRecordingObject(params: {
  key: string;
  body: Buffer;
  contentType?: string;
}): Promise<{ bucket: string; key: string }> {
  const bucket = getS3Bucket();
  if (!bucket) throw new Error("S3_AUDIO_BUCKET is not set");
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType || "application/octet-stream",
    }),
  );
  return { bucket, key: params.key };
}

export async function downloadRecordingToCache(params: {
  bucket: string;
  key: string;
  localPath: string;
}): Promise<string> {
  await fsp.mkdir(path.dirname(params.localPath), { recursive: true });
  const result = await getS3Client().send(
    new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
    }),
  );
  const buffer = await streamToBuffer(result.Body);
  await fsp.writeFile(params.localPath, buffer);
  return params.localPath;
}

export async function headRecordingObject(bucket: string, key: string): Promise<boolean> {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist Freshcaller bytes: always write local cache; when S3 enabled also PUT and return keys.
 */
export async function storeOriginalRecording(params: {
  callId: number;
  recordingId: number;
  callDate?: string | null;
  buffer: Buffer;
  extension: string;
  contentType?: string;
}): Promise<{
  localPath: string;
  localFileName: string;
  s3Bucket?: string;
  s3Key?: string;
}> {
  const localFileName = recordingFileName(params.callId, params.recordingId, params.extension);
  await fsp.mkdir(FC_RECORDINGS_DIR, { recursive: true });
  const localPath = path.join(FC_RECORDINGS_DIR, localFileName);
  await fsp.writeFile(localPath, params.buffer);

  if (!isS3Enabled()) {
    return { localPath, localFileName };
  }

  const key = buildRecordingS3Key({
    callId: params.callId,
    recordingId: params.recordingId,
    extension: params.extension,
    callDate: params.callDate,
  });
  const { bucket } = await putRecordingObject({
    key,
    body: params.buffer,
    contentType: params.contentType,
  });
  return { localPath, localFileName, s3Bucket: bucket, s3Key: key };
}

/**
 * Ensure a readable local file for analyze/ffmpeg.
 * Order: local cache → S3 GetObject → caller must Freshcaller-download if this returns null needFetch.
 */
export async function ensureCachedRecording(doc: {
  callId: number;
  recordingId: number;
  callDate?: string | null;
  localPath?: string | null;
  localFileName?: string | null;
  s3Bucket?: string | null;
  s3Key?: string | null;
}): Promise<{ localPath: string; localFileName: string; from: "cache" | "s3" } | null> {
  if (doc.localPath && (await fileExists(doc.localPath))) {
    return {
      localPath: doc.localPath,
      localFileName: doc.localFileName || path.basename(doc.localPath),
      from: "cache",
    };
  }

  if (isS3Enabled() && doc.s3Key) {
    const bucket = (doc.s3Bucket || getS3Bucket()).trim();
    if (!bucket) return null;
    const localFileName =
      doc.localFileName || path.basename(doc.s3Key) || recordingFileName(doc.callId, doc.recordingId, ".mp3");
    const localPath = path.join(FC_RECORDINGS_DIR, localFileName);
    await downloadRecordingToCache({ bucket, key: doc.s3Key, localPath });
    return { localPath, localFileName, from: "s3" };
  }

  return null;
}

/** Open a Node readable stream for HTTP playback (local file or S3 body). */
export async function openRecordingReadStream(doc: {
  callId: number;
  recordingId: number;
  callDate?: string | null;
  localPath?: string | null;
  localFileName?: string | null;
  s3Bucket?: string | null;
  s3Key?: string | null;
}): Promise<{ stream: Readable; contentType: string; from: "cache" | "s3"; localPath: string }> {
  if (doc.localPath && (await fileExists(doc.localPath))) {
    return {
      stream: fs.createReadStream(doc.localPath),
      contentType: guessContentType(doc.localPath),
      from: "cache",
      localPath: doc.localPath,
    };
  }

  if (isS3Enabled() && doc.s3Key) {
    const ensured = await ensureCachedRecording(doc);
    if (ensured) {
      return {
        stream: fs.createReadStream(ensured.localPath),
        contentType: guessContentType(ensured.localPath),
        from: "s3",
        localPath: ensured.localPath,
      };
    }
  }

  throw Object.assign(
    new Error("Audio not available locally or in S3. Re-run sync or analyze to download."),
    { status: 404 },
  );
}

function guessContentType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  return "application/octet-stream";
}

export function s3StatusForHealth(): { enabled: boolean; bucket: string | null; region: string } {
  return {
    enabled: isS3Enabled(),
    bucket: isS3Enabled() ? getS3Bucket() : null,
    region: (process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "ap-south-1").trim(),
  };
}
