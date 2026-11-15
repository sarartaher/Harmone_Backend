import { ObjectId } from "mongodb";
import { db, eventCollection } from "./db.js";

// Auth middleware: verifies Bearer token against MongoDB session collection
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).send({ message: "Authentication required" });
  }

  try {
    const session = await db.collection("session").findOne({
      token,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      return res.status(401).send({ message: "Invalid or expired session" });
    }

    const user = await db.collection("user").findOne({
      _id: new ObjectId(session.userId),
    });

    if (!user) {
      return res.status(401).send({ message: "User not found" });
    }

    req.user = { id: user._id.toString(), email: user.email, name: user.name };
    next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(401).send({ message: "Authentication failed" });
  }
}

// Ownership check: verifies the event belongs to the authenticated user
export async function requireOwnership(req, res, next) {
  try {
    const event = await eventCollection.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!event) {
      return res.status(404).send({ message: "Event not found" });
    }

    if (event.createdByEmail !== req.user.email) {
      return res.status(403).send({ message: "You do not own this event" });
    }

    req.event = event;
    next();
  } catch (error) {
    console.error("Ownership check error:", error);
    return res.status(500).send({ message: "Ownership check failed" });
  }
}
