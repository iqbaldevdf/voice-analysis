/**
 * Drop the entire MongoDB database (all collections) for a fresh start.
 *
 * Usage:
 *   npm run reset:db -- --confirm
 */
import "dotenv/config";
import { closeMongo, connectMongo, getDb, getMongoUri } from "../src/db/mongo.js";

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error("Refusing to run without --confirm");
    console.error("This permanently drops the entire MongoDB database.");
    process.exit(1);
  }

  const uri = getMongoUri();
  await connectMongo();
  const db = getDb();
  const name = db.databaseName;

  const before = await db.listCollections().toArray();
  const counts: Record<string, number> = {};
  for (const coll of before) {
    counts[coll.name] = await db.collection(coll.name).countDocuments();
  }

  const dropped = await db.dropDatabase();
  await closeMongo();

  console.log(
    JSON.stringify(
      {
        uri,
        database: name,
        dropped: dropped,
        collectionsRemoved: before.map((c) => c.name),
        documentCounts: counts,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
