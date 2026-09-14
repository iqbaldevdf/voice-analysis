import type { FreshcallerCall } from "./types.js";

function requireConfig() {
  const baseUrl = (process.env.FRESHCALLER_BASE_URL ?? "").replace(/\/$/, "");
  const apiAuth = (process.env.FRESHCALLER_API_AUTH ?? "").trim();
  if (!baseUrl) {
    throw new Error("FRESHCALLER_BASE_URL is not configured");
  }
  if (!apiAuth || apiAuth === "changeme") {
    throw new Error("FRESHCALLER_API_AUTH is not configured");
  }
  return { baseUrl, apiAuth };
}

function authHeaders(apiAuth: string): Record<string, string> {
  return {
    "X-Api-Auth": apiAuth,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

export type CreateExportInput = {
  startDate: string;
  endDate: string;
};

export type CreateExportResult = {
  id: number;
  status: string;
  message?: string;
};

export type BulkJobResponse = {
  bulk_job: {
    id: number;
    status: string;
    created_time?: string;
    updated_time?: string;
    job_data?: {
      path?: string;
    };
    errors?: Array<{ error_type?: string; message?: string | null }>;
    links?: Array<{ href: string; method: string; rel: string }>;
  };
};

type CallsListResponse = {
  calls?: Record<string, unknown>[];
  meta?: {
    total_pages?: number;
    current_page?: number;
    total_count?: number;
  };
};

export class FreshcallerClient {
  private readonly baseUrl: string;
  private readonly apiAuth: string;

  constructor() {
    const cfg = requireConfig();
    this.baseUrl = cfg.baseUrl;
    this.apiAuth = cfg.apiAuth;
  }

  async createExport(input: CreateExportInput): Promise<CreateExportResult> {
    const response = await fetch(`${this.baseUrl}/api/v1/account/export`, {
      method: "POST",
      headers: authHeaders(this.apiAuth),
      body: JSON.stringify({
        date_range: {
          start_date: input.startDate,
          end_date: input.endDate,
        },
        resources: [
          {
            name: "calls",
            include: [
              "participants",
              "recording",
              "life_cycle",
              "recording_to_redact",
              "integrated_resources",
            ],
          },
        ],
        output_format: "json",
        delivery_type: "email",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Freshcaller export failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as CreateExportResult;
    if (!data.id) {
      throw new Error(`Freshcaller export response missing id: ${JSON.stringify(data)}`);
    }
    return data;
  }

  /**
   * Paginated fallback when Freshcaller bulk export jobs fail.
   * Uses GET /api/v1/calls with by_time[from|to] (same IST window as export).
   */
  async listCallsInRange(input: CreateExportInput): Promise<FreshcallerCall[]> {
    const perPage = 1000;
    const all: FreshcallerCall[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const params = new URLSearchParams({
        per_page: String(perPage),
        page: String(page),
        "by_time[from]": input.startDate,
        "by_time[to]": input.endDate,
      });
      const response = await fetch(`${this.baseUrl}/api/v1/calls?${params}`, {
        method: "GET",
        headers: authHeaders(this.apiAuth),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Freshcaller calls list failed (${response.status}): ${body.slice(0, 300)}`);
      }
      const data = (await response.json()) as CallsListResponse;
      const batch = Array.isArray(data.calls) ? data.calls : [];
      all.push(...batch.map((item) => summarizeCall(item)));
      totalPages = Math.max(1, Number(data.meta?.total_pages ?? page));
      page += 1;
    }

    return all;
  }

  async getJob(jobId: number): Promise<BulkJobResponse> {
    const response = await fetch(`${this.baseUrl}/api/v1/jobs/${jobId}`, {
      method: "GET",
      headers: authHeaders(this.apiAuth),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Freshcaller job status failed (${response.status}): ${body}`);
    }

    return (await response.json()) as BulkJobResponse;
  }

  async downloadZip(url: string): Promise<Buffer> {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/zip, application/octet-stream, */*" },
      redirect: "follow",
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Export ZIP download failed (${response.status}): ${body.slice(0, 300)}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get("content-type") ?? "";
    // Guard against HTML/error bodies saved as .zip
    if (
      buffer.length > 0 &&
      (contentType.includes("text/html") ||
        contentType.includes("application/json") ||
        buffer.subarray(0, 1).toString("utf8") === "<" ||
        buffer.subarray(0, 1).toString("utf8") === "{")
    ) {
      throw new Error(
        `Export download returned ${contentType || "non-ZIP"} (${buffer.length} bytes), not a ZIP archive`,
      );
    }
    return buffer;
  }

  async downloadRecording(callId: number, recordingId: number): Promise<{
    buffer: Buffer;
    contentType: string | null;
    extension: string;
  }> {
    const url = `${this.baseUrl}/api/v1/calls/${callId}/recording/${recordingId}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Api-Auth": this.apiAuth,
        Accept: "application/json, audio/*, */*",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Recording download failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const contentType = response.headers.get("content-type");

    // Some Freshcaller responses return JSON with a signed URL
    if (contentType?.includes("application/json")) {
      const data = (await response.json()) as Record<string, unknown>;
      const recordingObj = data.recording as Record<string, unknown> | undefined;
      const nested =
        recordingObj?.download_url ??
        recordingObj?.url ??
        data.download_url ??
        data.url ??
        data.redirect_url;
      if (typeof nested === "string" && nested.startsWith("http")) {
        const audioRes = await fetch(nested, { method: "GET", redirect: "follow" });
        if (!audioRes.ok) {
          throw new Error(`Recording URL fetch failed (${audioRes.status})`);
        }
        const audioType = audioRes.headers.get("content-type");
        const buffer = Buffer.from(await audioRes.arrayBuffer());
        return {
          buffer,
          contentType: audioType,
          extension: extensionFromContentType(audioType) || guessExtensionFromUrl(nested) || ".mp3",
        };
      }
      throw new Error(`Unexpected recording JSON: ${JSON.stringify(data).slice(0, 200)}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      buffer,
      contentType,
      extension: extensionFromContentType(contentType) || ".mp3",
    };
  }
}

function extensionFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const lower = contentType.toLowerCase();
  if (lower.includes("wav")) return ".wav";
  if (lower.includes("mpeg") || lower.includes("mp3")) return ".mp3";
  if (lower.includes("mp4") || lower.includes("m4a")) return ".m4a";
  if (lower.includes("ogg")) return ".ogg";
  if (lower.includes("webm")) return ".webm";
  if (lower.includes("flac")) return ".flac";
  return null;
}

function guessExtensionFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const match = pathname.match(/\.(wav|mp3|m4a|ogg|webm|flac)(?:$|\?)/i);
    return match ? `.${match[1].toLowerCase()}` : null;
  } catch {
    return null;
  }
}

export function summarizeCall(raw: Record<string, unknown>): FreshcallerCall {
  const recordingRaw = raw.recording as Record<string, unknown> | null | undefined;
  const recording =
    recordingRaw && typeof recordingRaw.id === "number"
      ? {
          id: recordingRaw.id as number,
          url: String(recordingRaw.url ?? ""),
          transcription_url: (recordingRaw.transcription_url as string | null) ?? null,
          duration: typeof recordingRaw.duration === "number" ? recordingRaw.duration : undefined,
          duration_unit:
            typeof recordingRaw.duration_unit === "string" ? recordingRaw.duration_unit : undefined,
        }
      : null;

  const participants = Array.isArray(raw.participants)
    ? (raw.participants as FreshcallerCall["participants"])
    : [];

  const life_cycle = Array.isArray(raw.life_cycle)
    ? (raw.life_cycle as FreshcallerCall["life_cycle"])
    : [];

  return {
    id: Number(raw.id),
    direction: String(raw.direction ?? "unknown"),
    phone_number: (raw.phone_number as string | null) ?? null,
    assigned_agent_id: (raw.assigned_agent_id as number | null) ?? null,
    assigned_agent_name: (raw.assigned_agent_name as string | null) ?? null,
    assigned_team_name: (raw.assigned_team_name as string | null) ?? null,
    bill_duration: typeof raw.bill_duration === "number" ? raw.bill_duration : null,
    bill_duration_unit: (raw.bill_duration_unit as string | null) ?? null,
    created_time: String(raw.created_time ?? new Date().toISOString()),
    updated_time: raw.updated_time ? String(raw.updated_time) : undefined,
    call_notes: (raw.call_notes as string | null) ?? null,
    recording,
    participants,
    life_cycle,
  };
}
