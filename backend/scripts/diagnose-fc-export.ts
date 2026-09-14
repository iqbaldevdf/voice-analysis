import "dotenv/config";
import { closeMongo, connectMongo } from "../src/db/mongo.js";
import { FreshcallerClient } from "../src/freshcaller/client.js";
import { istDayRangeIso } from "../src/freshcaller/dateUtils.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollJob(client: FreshcallerClient, jobId: number, label: string) {
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    const status = await client.getJob(jobId);
    const bulk = status.bulk_job as Record<string, unknown>;
    const errors = bulk.errors as unknown[] | undefined;
    console.log(`[${label}] attempt ${attempt}: status=${bulk.status}`, {
      path: (bulk.job_data as { path?: string } | undefined)?.path ?? null,
      errors: errors ?? null,
    });
    const remote = String(bulk.status ?? "").toLowerCase();
    if (remote === "completed" || remote === "failed" || remote === "error") {
      return status;
    }
    await sleep(4000);
  }
  return client.getJob(jobId);
}

async function main() {
  const callDate = process.argv[2] ?? "2026-09-03";
  const jobIdArg = process.argv[3];
  const { startDate, endDate } = istDayRangeIso(callDate);

  await connectMongo();
  const client = new FreshcallerClient();

  if (jobIdArg) {
    const existing = await client.getJob(Number(jobIdArg));
    console.log("existing job:", JSON.stringify(existing, null, 2));
    await closeMongo();
    return;
  }

  // Inspect recent failed job 20180
  const failed = await client.getJob(20180);
  console.log("job 20180:", JSON.stringify(failed, null, 2));

  // Try minimal export payload (fewer includes)
  const baseUrl = (process.env.FRESHCALLER_BASE_URL ?? "").replace(/\/$/, "");
  const apiAuth = (process.env.FRESHCALLER_API_AUTH ?? "").trim();
  const headers = {
    "X-Api-Auth": apiAuth,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const payloads = [
    {
      label: "minimal-email",
      body: {
        date_range: { start_date: startDate, end_date: endDate },
        resources: [{ name: "calls", include: ["participants", "recording"] }],
        output_format: "json",
        delivery_type: "email",
      },
    },
    {
      label: "full-email",
      body: {
        date_range: { start_date: startDate, end_date: endDate },
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
      },
    },
  ];

  for (const payload of payloads) {
    console.log(`\n--- testing ${payload.label} ---`);
    const response = await fetch(`${baseUrl}/api/v1/account/export`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload.body),
    });
    const text = await response.text();
    if (!response.ok) {
      console.log("create failed:", response.status, text.slice(0, 500));
      continue;
    }
    const created = JSON.parse(text) as { id: number; status: string };
    console.log("created:", created);
    const final = await pollJob(client, created.id, payload.label);
    console.log("final:", JSON.stringify(final, null, 2));
    const status = String(final.bulk_job.status).toLowerCase();
    if (status === "completed") {
      console.log("SUCCESS with", payload.label);
      break;
    }
  }

  await closeMongo();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
