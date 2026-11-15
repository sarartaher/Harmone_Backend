import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

dotenv.config();
const PORT = process.env.PORT;
const app = express();
app.use(express.json());
app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded files statically
app.use("/uploads", express.static(uploadsDir));

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

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
const joinedEventsCollection = db.collection("joinedEvents");

// Join an event (record the join)
app.post("/events/:id/join", async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).send({ message: "Email is required" });
    }

    // Check if already joined
    const existing = await joinedEventsCollection.findOne({
      eventId: id,
      email,
    });

    if (existing) {
      return res.send({ message: "Already joined", alreadyJoined: true });
    }

    await joinedEventsCollection.insertOne({
      eventId: id,
      email,
      joinedAt: new Date(),
    });

    res.send({ message: "Joined successfully" });
  } catch (error) {
    console.error("Error joining event:", error);
    res.status(500).send({
      message: "Something went wrong",
      error: error.message,
    });
  }
});

// Get joined events for a user
app.get("/account/joined", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).send({ message: "Email is required" });
    }

    const joins = await joinedEventsCollection.find({ email }).toArray();
    const eventIds = joins
      .map((j) => {
        try {
          return new ObjectId(j.eventId);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const events = await eventCollection
      .find({ _id: { $in: eventIds } })
      .toArray();

    // Add joinedAt to each event
    const result = events.map((e) => {
      const join = joins.find((j) => j.eventId === e._id.toString());
      return { ...e, joinedAt: join?.joinedAt };
    });

    res.send(result);
  } catch (error) {
    console.error("Error fetching joined events:", error);
    res.status(500).send({
      message: "Failed to fetch joined events",
    });
  }
});

// Create event with file upload support
app.post("/events", upload.single("thumbnail"), async (req, res) => {
  try {
    const body = {
      ...req.body,
      eventDate: new Date(req.body.eventDate),
    };

    // If a file was uploaded, store the URL path
    if (req.file) {
      body.thumbnail = `/uploads/${req.file.filename}`;
    }

    const result = await eventCollection.insertOne(body);

    res.send({
      message: "Event created successfully",
      insertedId: result.insertedId,
      thumbnail: body.thumbnail
        ? `http://localhost:${PORT}${body.thumbnail}`
        : null,
    });
  } catch (error) {
    console.error("Error inserting event:", error);

    res.status(500).send({
      message: "Something went wrong",
      error: error.message,
    });
  }
});

// Bulk insert (JSON only, no file upload)
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

    // Prepend base URL to thumbnail paths
    const baseUrl = `http://localhost:${PORT}`;
    const eventsWithUrls = events.map((event) => ({
      ...event,
      thumbnail: event.thumbnail
        ? event.thumbnail.startsWith("http")
          ? event.thumbnail
          : `${baseUrl}${event.thumbnail}`
        : event.thumbnail,
    }));

    res.send(eventsWithUrls);
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

    // Prepend base URL to thumbnail paths
    const baseUrl = `http://localhost:${PORT}`;
    const eventsWithUrls = events.map((event) => ({
      ...event,
      thumbnail: event.thumbnail
        ? event.thumbnail.startsWith("http")
          ? event.thumbnail
          : `${baseUrl}${event.thumbnail}`
        : event.thumbnail,
    }));

    res.send(eventsWithUrls);
  } catch (error) {
    console.error("Error fetching events");
    res.status(500).send({
      message: "Failed to fetch events",
    });
  }
});

// Get managed events (events created by a specific user)
app.get("/account/events", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).send({ message: "Email is required" });
    }

    const events = await eventCollection
      .find({ createdByEmail: email })
      .sort({ eventDate: 1 })
      .toArray();

    res.send(events);
  } catch (error) {
    console.error("Error fetching managed events:", error);
    res.status(500).send({
      message: "Failed to fetch managed events",
    });
  }
});

// Update event status
app.patch("/account/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["published", "draft"].includes(status)) {
      return res.status(400).send({ message: "Invalid status" });
    }

    const result = await eventCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "Event not found" });
    }

    res.send({ message: "Event updated successfully" });
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).send({
      message: "Failed to update event",
      error: error.message,
    });
  }
});

// Delete an event
app.delete("/account/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await eventCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Event not found" });
    }

    res.send({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).send({
      message: "Failed to delete event",
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log({
    message: `Server is running on ${PORT}`,
  });
});
