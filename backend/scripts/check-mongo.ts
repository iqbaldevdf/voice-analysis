import "dotenv/config";
import { closeMongo, connectMongo, getMongoUri, pingMongo } from "../src/db/mongo.js";

async function main() {
  await connectMongo();
  console.log("uri", getMongoUri());
  console.log("ping", await pingMongo());
  await closeMongo();
  console.log("ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
