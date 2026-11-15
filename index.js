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

const PORT = process.env.PORT || 8800;

const BASE_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;

const app = express();

app.use(express.json());

// CORS configuration

const allowedOrigins = ["https://harmoine.vercel.app", "http://localhost:3100"];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests without an origin
      if (!origin) {
        return callback(null, true);
      }

      // Allow production and local frontend
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Allow Vercel preview deployments of this project
      if (/^https:\/\/harmoine-[a-z0-9-]+\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }

      console.log("Blocked origin:", origin);
      callback(null, false);
    },
    credentials: true,
  }),
);

// File upload configuration

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use("/uploads", express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },

  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);

    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

// Join an event

app.post("/events/:id/join", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const email = req.user.email;

    const existing = await joinedEventsCollection.findOne({
      eventId: id,
      email: email,
    });

    if (existing) {
      return res.send({
        message: "Already joined",
        alreadyJoined: true,
      });
    }

    await joinedEventsCollection.insertOne({
      eventId: id,
      email: email,
      joinedAt: new Date(),
    });

    res.send({
      message: "Joined successfully",
    });
  } catch (error) {
    console.log("Error joining event:", error);

    res.status(500).send({
      message: "Something went wrong",
      error: error.message,
    });
  }
});

// Get joined events

app.get("/account/joined", requireAuth, async (req, res) => {
  try {
    const email = req.user.email;

    const joins = await joinedEventsCollection.find({ email: email }).toArray();

    const eventIds = joins
      .map((join) => {
        try {
          return new ObjectId(join.eventId);
        } catch {
          return null;
        }
      })
      .filter((id) => id !== null);

    const events = await eventCollection
      .find({
        _id: { $in: eventIds },
      })
      .toArray();

    const result = events.map((event) => {
      const join = joins.find((item) => item.eventId === event._id.toString());

      return {
        ...event,
        joinedAt: join?.joinedAt,
      };
    });

    res.send(result);
  } catch (error) {
    console.log("Error fetching joined events:", error);

    res.status(500).send({
      message: "Failed to fetch joined events",
    });
  }
});

// Create an event

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
      console.log("Error inserting event:", error);

      res.status(500).send({
        message: "Something went wrong",
        error: error.message,
      });
    }
  },
);

// Insert multiple events

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
    console.log("Error inserting multiple events:", error);

    res.status(500).send({
      message: "Something went wrong",
      error: error.message,
    });
  }
});

// Get all upcoming events

app.get("/events", async (req, res) => {
  try {
    const events = await eventCollection
      .find({
        eventDate: { $gt: new Date() },
      })
      .sort({ eventDate: 1 })
      .toArray();

    const eventsWithUrls = events.map((event) => ({
      ...event,
      thumbnail: event.thumbnail
        ? event.thumbnail.startsWith("http")
          ? event.thumbnail
          : `${BASE_URL}${event.thumbnail}`
        : event.thumbnail,
    }));

    res.send(eventsWithUrls);
  } catch (error) {
    console.log("Error fetching events:", error);

    res.status(500).send({
      message: "Failed to fetch events",
    });
  }
});

// Get recent events

app.get("/events/recent", async (req, res) => {
  try {
    const events = await eventCollection
      .find({
        eventDate: { $gt: new Date() },
      })
      .sort({ eventDate: 1 })
      .limit(6)
      .toArray();

    const eventsWithUrls = events.map((event) => ({
      ...event,
      thumbnail: event.thumbnail
        ? event.thumbnail.startsWith("http")
          ? event.thumbnail
          : `${BASE_URL}${event.thumbnail}`
        : event.thumbnail,
    }));

    res.send(eventsWithUrls);
  } catch (error) {
    console.log("Error fetching recent events:", error);

    res.status(500).send({
      message: "Failed to fetch events",
    });
  }
});

// Get events for the management page

app.get("/account/events", async (req, res) => {
  try {
    const category = req.query.category;

    let filter = {};

    if (category && category !== "all") {
      filter = {
        eventType: category,
      };
    }

    const events = await eventCollection
      .find(filter)
      .sort({ eventDate: 1 })
      .toArray();

    res.send(events);
  } catch (error) {
    console.log("Error fetching managed events:", error);

    res.status(500).send({
      message: "Failed to fetch managed events",
    });
  }
});

// Update an event

app.patch(
  "/account/events/:id",
  requireAuth,
  requireOwnership,
  upload.single("thumbnail"),
  async (req, res) => {
    try {
      const id = req.params.id;
      const updates = { ...req.body };

      if (updates.eventDate) {
        updates.eventDate = new Date(updates.eventDate);
      }

      if (req.file) {
        updates.thumbnail = `${BASE_URL}/uploads/${req.file.filename}`;
      }

      delete updates._id;

      const result = await eventCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updates },
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({
          message: "Event not found",
        });
      }

      res.send({
        message: "Event updated successfully",
      });
    } catch (error) {
      console.log("Error updating event:", error);

      res.status(500).send({
        message: "Failed to update event",
        error: error.message,
      });
    }
  },
);

// Delete an event

app.delete(
  "/account/events/:id",
  requireAuth,
  requireOwnership,
  async (req, res) => {
    try {
      const id = req.params.id;

      const result = await eventCollection.deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount === 0) {
        return res.status(404).send({
          message: "Event not found",
        });
      }

      res.send({
        message: "Event deleted successfully",
      });
    } catch (error) {
      console.log("Error deleting event:", error);

      res.status(500).send({
        message: "Failed to delete event",
        error: error.message,
      });
    }
  },
);

// Get user profile

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
    console.log("Error fetching profile:", error);

    res.status(500).send({
      message: "Failed to load profile",
    });
  }
});

// Update user profile

app.patch("/account/profile", requireAuth, async (req, res) => {
  try {
    const name = req.body.name;

    if (!name || name.trim() === "") {
      return res.status(400).send({
        message: "Name is required",
      });
    }

    await userCollection.updateOne(
      { _id: new ObjectId(req.user.id) },
      {
        $set: { name: name },
      },
    );

    res.send({
      message: "Profile updated successfully",
    });
  } catch (error) {
    console.log("Error updating profile:", error);

    res.status(500).send({
      message: "Failed to update profile",
    });
  }
});

// Start server locally

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

export default app;
