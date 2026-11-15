import express from "express";
import { ObjectId } from "mongodb";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { requireAuth, requireOwnership } from "./auth-middleware.js";
import {
  eventCollection,
  joinedEventsCollection,
  userCollection,
} from "./db.js";

dotenv.config();
const PORT = process.env.PORT;
// Base URL used when building absolute links (thumbnails). Change this in
// production .env instead of editing code.
const BASE_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;
const app = express();
app.use(express.json());
// Allow the deployed frontend origin (or any origin in dev) to call the API.
const allowedFrontend = process.env.FRONTEND_URL;
app.use(
  cors(
    allowedFrontend
      ? { origin: [allowedFrontend], credentials: true }
      : { origin: true, credentials: true },
  ),
);

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

// Join an event (protected: requires auth)
app.post("/events/:id/join", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const email = req.user.email;

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

// Get joined events for authenticated user (protected)
app.get("/account/joined", requireAuth, async (req, res) => {
  try {
    const email = req.user.email;

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

// Create event with file upload support (protected: requires auth)
app.post(
  "/events",
  requireAuth,
  upload.single("thumbnail"),
  async (req, res) => {
    try {
      const body = {
        ...req.body,
        eventDate: new Date(req.body.eventDate),
        createdByEmail: req.user.email,
      };

      // If a file was uploaded, store the URL path
      if (req.file) {
        body.thumbnail = `/uploads/${req.file.filename}`;
      }

      const result = await eventCollection.insertOne(body);

      res.send({
        message: "Event created successfully",
        insertedId: result.insertedId,
        thumbnail: body.thumbnail ? `${BASE_URL}${body.thumbnail}` : null,
      });
    } catch (error) {
      console.error("Error inserting event:", error);

      res.status(500).send({
        message: "Something went wrong",
        error: error.message,
      });
    }
  },
);

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
    const baseUrl = BASE_URL;
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
    const baseUrl = BASE_URL;
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

// Get all events (for manage events page), optionally filter by category
app.get("/account/events", async (req, res) => {
  try {
    const { category } = req.query;

    const filter =
      category && category !== "all" ? { eventType: category } : {};

    const events = await eventCollection
      .find(filter)
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

// Update event (full update or status only, supports file upload, protected + ownership)
app.patch(
  "/account/events/:id",
  requireAuth,
  requireOwnership,
  upload.single("thumbnail"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = { ...req.body };

      // Convert eventDate to Date if provided
      if (updates.eventDate) {
        updates.eventDate = new Date(updates.eventDate);
      }

      // If a file was uploaded, store the URL path
      if (req.file) {
        updates.thumbnail = `${BASE_URL}/uploads/${req.file.filename}`;
      }

      // Remove _id from updates to avoid immutable field error
      delete updates._id;

      const result = await eventCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updates },
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
  },
);

// Delete an event (protected + ownership)
app.delete(
  "/account/events/:id",
  requireAuth,
  requireOwnership,
  async (req, res) => {
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
  },
);

// Get profile for authenticated user
app.get("/account/profile", requireAuth, async (req, res) => {
  try {
    const user = await userCollection.findOne({
      _id: new ObjectId(req.user.id),
    });
    res.send({
      name: user?.name,
      email: user?.email,
      createdAt: user?.createdAt,
      updatedAt: user?.updatedAt,
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).send({ message: "Failed to load profile" });
  }
});

// Update profile (name only)
app.patch("/account/profile", requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || name.trim() === "") {
      return res.status(400).send({ message: "Name is required" });
    }
    await userCollection.updateOne(
      { _id: new ObjectId(req.user.id) },
      { $set: { name } },
    );
    res.send({ message: "Profile updated successfully" });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).send({ message: "Failed to update profile" });
  }
});

app.listen(PORT, () => {
  console.log({
    message: `Server is running on ${PORT}`,
  });
});
