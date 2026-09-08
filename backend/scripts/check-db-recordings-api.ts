import "dotenv/config";
import { closeMongo, connectMongo, recordingsCollection } from "../src/db/mongo.js";
import { createDbRecordingsRouter } from "../src/routes/dbRecordings.js";
import express from "express";

async function main() {
  await connectMongo();
  const total = await recordingsCollection().countDocuments();
  console.log("mongo recordings count:", total);

  const app = express();
  app.use("/recordings/db", createDbRecordingsRouter());
  const server = app.listen(0, async () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const listRes = await fetch(`http://127.0.0.1:${port}/recordings/db?limit=2`);
    const listBody = await listRes.json();
    console.log("GET /recordings/db status:", listRes.status, "total:", listBody.total, "page:", listBody.recordings?.length);

    const first = listBody.recordings?.[0];
    if (first) {
      const oneRes = await fetch(`http://127.0.0.1:${port}/recordings/db/${first.callId}`);
      const oneBody = await oneRes.json();
      console.log(
        "GET /recordings/db/:callId status:",
        oneRes.status,
        "callId:",
        oneBody.recording?.callId,
        "hasAudio:",
        oneBody.recording?.hasLocalAudio,
      );

      const audioRes = await fetch(`http://127.0.0.1:${port}/recordings/db/${first.callId}/audio`);
      console.log("GET /recordings/db/:callId/audio status:", audioRes.status);
    }

    server.close();
    await closeMongo();
  });
}

main().catch(async (err) => {
  console.error(err);
  await closeMongo().catch(() => undefined);
  process.exit(1);
});
