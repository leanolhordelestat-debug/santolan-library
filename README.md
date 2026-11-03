# Santolan High School Library

Node.js + Postgres server. Everyone can search the catalog; only the admin can sign in to add books, scan covers and track borrowers.

## Deploy on Render
1. Upload this folder to a **private** GitHub repository.
2. In Render: **New -> Blueprint**, pick the repo. It reads `render.yaml` and creates the web service and database.
3. When asked, set `ADMIN_PASSWORD` (a long, unique password). Optionally set `ANTHROPIC_API_KEY` to turn on cover scanning (create one at console.anthropic.com; usage is billed to you).
4. Open the Render URL. Click **Admin login** at the top right.

## Run locally
    npm install
    DATABASE_URL=postgres://user:pass@localhost/library PGSSL=off ADMIN_PASSWORD=change-me npm start

Notes: borrower names are only ever sent to a signed-in admin. Check Render's current plans: free web services sleep when idle and free databases can expire, so use a paid database for real records and back up with the Export CSV button.
