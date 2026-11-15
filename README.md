# Hermone — Backend (Express + MongoDB)

API server for the Hermone social development events platform.
Handles events, joining, managing, profiles, and authentication sessions.

## Quick start

```bash
npm install
npm run dev
```

The server listens on the port from `PORT` (default `8800`).
There is no `npm start` script — for production use `node index.js`.

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | What it does |
|----------|--------------|
| `MONGO_URI` | MongoDB connection string (Atlas or local) |
| `PORT` | Port to listen on (e.g. `8800`) |
| `DB_NAME` | MongoDB database name (e.g. `Harmone`) |
| `BACKEND_URL` | Public URL of this backend — used to build image links. Falls back to `http://localhost:{PORT}` when unset |
| `FRONTEND_URL` | Frontend origin allowed by CORS. Leave unset in local dev to allow any origin |

## Project structure

```
index.js             # all routes
auth-middleware.js   # requireAuth + requireOwnership
db.js                # shared MongoDB connection and collections
uploads/             # uploaded event images
.env                 # secrets (do not commit)
.env.example         # template
```

## Authentication

The backend does not store users itself — Better Auth (on the frontend) writes sessions and users into MongoDB.
For protected routes the backend checks:

```
Authorization: Bearer <session-token>
```

The token is looked up in the `session` collection; expired or unknown tokens get `401`.

## Endpoints

### Public

| Method | Path | What it does |
|--------|------|--------------|
| `GET` | `/events` | Future events (sorted by date). Thumbnails become absolute URLs. |
| `GET` | `/events/recent` | First 6 future events |

### Protected (need `Authorization: Bearer ...`)

| Method | Path | What it does |
|--------|------|--------------|
| `POST` | `/events` | Create an event. Multipart form with `title`, `description`, `eventType`, `location`, `eventDate`, optional `thumbnail` (image file). The creator email comes from the session. |
| `POST` | `/events/:id/join` | Record a join for the logged-in user. Duplicate joins return `{ alreadyJoined: true }`. |
| `GET` | `/account/events` | List all events (for the manage page). Optional `?category=` filter. |
| `PATCH` | `/account/events/:id` | Update an event. Multipart or JSON. Owner only. |
| `DELETE` | `/account/events/:id` | Delete an event. Owner only. |
| `GET` | `/account/joined` | Events the logged-in user joined, with `joinedAt`. |
| `GET` | `/account/profile` | The logged-in user's name, email, and timestamps. |
| `PATCH` | `/account/profile` | Update the logged-in user's name. Body: `{ "name": "..." }`. |

## File uploads

Images are stored on disk in `uploads/` and served at `/uploads/<filename>`.
Limit: **5 MB**, images only (`image/*`).
The stored path is converted to a full URL using `BACKEND_URL` before being returned or saved.

## Running

```bash
npm run dev      # with nodemon (auto-restart)
node index.js    # plain run
```

## Notes

- `GET /events` only returns events whose `eventDate` is in the future.
- `GET /account/events` returns **all** events (including past ones) so the manage page can list everything.
- CORS is configured from `FRONTEND_URL`; unset it locally to allow all origins.
- Better Auth needs these collections to exist in the same database: `user`, `session`, `account`.
