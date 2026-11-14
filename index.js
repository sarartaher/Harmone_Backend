import express from "express";
import { MongoClient } from "mongodb";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const PORT = process.env.PORT;
const app = express();
app.use(express.json());
app.use(cors());

const client = new MongoClient(process.env.MONGO_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
    throw err;
  }
}
const mongoClient = await connectToMongoDB();
const db = mongoClient.db(process.env.DB_NAME);
const eventCollection = db.collection("events");

app.post("/events", async (req, res) => {
  try {
    const body = {
      ...req.body,
      eventDate: new Date(req.body.eventDate),
    };

    const result = await eventCollection.insertOne(body);

    res.send({
      message: "Event created successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Error inserting event:", error);

    res.status(500).send({
      message: "Something went wrong",
      error: error.message,
    });
  }
});
app.post("/events/bulk", async (req, res) => {
  try {
    const events = req.body.map((event) => ({
      ...event,
      eventDate: new Date(event.eventDate),
    }));

    const result = await eventCollection.insertMany(events);

    res.send({
      message: "Events inserted successfully",
      insertedCount: result.insertedCount,
    });
  } catch (error) {
    console.error("Error inserting multiple events:", error);

    res.status(500).send({
      message: "Something went wrong",
      error: error.message,
    });
  }
});
app.get("/events", async (req, res) => {
  try {
    const events = await eventCollection
      .find({
        eventDate: { $gt: new Date() },
      })
      .sort({ eventDate: 1 })
      .toArray();

    res.send(events);
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).send({
      message: "Failed to fetch events",
    });
  }
});
app.get("/events/recent", async (req, res) => {
  try {
    const events = await eventCollection
      .find({
        eventDate: { $gt: new Date() },
      })
      .sort({ eventDate: 1 })
      .limit(6)
      .toArray();
    res.send(events);
  } catch (error) {
    console.error("Error fetching events");
    res.status(500).send({
      message: "Failed to fetch events",
    });
  }
});
app.listen(PORT, () => {
  console.log({
    message: `Server is running on ${PORT}`,
  });
});
