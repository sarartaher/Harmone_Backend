import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;

if (!MONGO_URI) {
  throw new Error("MONGO_URI is missing");
}

if (!DB_NAME) {
  throw new Error("DB_NAME is missing");
}

const client = new MongoClient(MONGO_URI);
await client.connect();

export const db = client.db(DB_NAME);

export const eventCollection = db.collection("events");
export const joinedEventsCollection = db.collection("joinedEvents");
export const userCollection = db.collection("user");

export function toObjectId(id) {
  return new ObjectId(id);
}
