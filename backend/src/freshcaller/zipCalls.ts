import path from "node:path";
import AdmZip from "adm-zip";

export type ZipCallJson = {
  entryName: string;
  rawText: string;
  empty: boolean;
  entryNames: string[];
};

/**
 * Freshcaller exports place JSON under `calls/calls_*.json`.
 * Empty days return a valid 22-byte ZIP with no entries.
 */
export function extractCallsJsonFromZip(zipBuffer: Buffer): ZipCallJson {
  if (!zipBuffer.length || zipBuffer.length < 4) {
    throw new Error(`Export ZIP is empty or truncated (${zipBuffer.length} bytes)`);
  }
  if (zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4b) {
    const preview = zipBuffer.subarray(0, 120).toString("utf8").replace(/\s+/g, " ");
    throw new Error(
      `Download was not a ZIP file (${zipBuffer.length} bytes). Preview: ${preview.slice(0, 160)}`,
    );
  }

  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const entryNames = entries.map((entry) => entry.entryName);

  // Empty archive = no calls for that date range
  if (entries.length === 0) {
    return {
      entryName: "",
      rawText: '{"calls":[]}',
      empty: true,
      entryNames,
    };
  }

  const jsonEntry =
    entries.find((entry) => /^calls_.*\.json$/i.test(path.basename(entry.entryName))) ??
    entries.find((entry) => /calls_.*\.json$/i.test(entry.entryName.replace(/\\/g, "/"))) ??
    entries.find((entry) => /\.json$/i.test(entry.entryName));

  if (!jsonEntry) {
    throw new Error(
      `Export ZIP has no calls JSON. Entries: ${entryNames.slice(0, 20).join(", ") || "(none)"}`,
    );
  }

  return {
    entryName: path.basename(jsonEntry.entryName),
    rawText: jsonEntry.getData().toString("utf8"),
    empty: false,
    entryNames,
  };
}
