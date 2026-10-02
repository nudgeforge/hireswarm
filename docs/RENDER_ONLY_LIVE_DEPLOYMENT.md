# HireSwarm Render-only live deployment

Use this route when you do not want Vercel. GitHub remains the source repository; Render hosts **two** web services and gives the team a live `onrender.com` link.

```text
GitHub main branch
  ├── hireswarm-api  (FastAPI, Render Web Service)
  └── hireswarm-web  (Next.js, Render Docker Web Service)

Team shares: https://hireswarm-web.onrender.com
```

> Do not use GitHub Pages for the full product. GitHub Pages cannot run this FastAPI API or its SSE rehearsal stream.

## 1. Deploy backend first

1. In Render: **New → Blueprint**.
2. Connect the GitHub repository and select it.
3. Let Render read the root `render.yaml`.
4. Use Free compute if available.
5. Confirm the API service settings:

```text
Name: hireswarm-api
Root directory: backend
Build: pip install -r requirements.txt
Start: uvicorn app.main:app --host 0.0.0.0 --port $PORT
Health check: /healthz
USE_CREWAI=false
```

6. Deploy and wait for success.
7. Copy the public API base URL — not the `/healthz` path — for example:

```text
https://hireswarm-api.onrender.com
```

8. Verify:

```text
https://hireswarm-api.onrender.com/healthz
```

It must return JSON with `"ok": true`.

## 2. Deploy frontend second

1. In Render: **New → Web Service**.
2. Select the same GitHub repository.
3. Configure exactly:

| Setting | Value |
|---|---|
| Name | `hireswarm-web` (choose a unique name if unavailable) |
| Branch | `main` |
| Runtime / Language | **Docker** |
| Root Directory | `frontend` |
| Dockerfile Path | `./Dockerfile` |
| Docker Build Context Directory | `.` |
| Health Check Path | `/` |
| Plan | Free, if available |

4. Add this environment variable **before first deploy**:

```text
BACKEND_URL=https://YOUR-API-NAME.onrender.com
```

Use your actual backend Render URL; do not include `/healthz`.

The frontend Dockerfile consumes `BACKEND_URL` during the Next.js build and at runtime. Render supplies Docker-service environment variables as build arguments as well, so this one value correctly configures the `/backend` rewrite.

5. Click **Create Web Service** / **Deploy**.
6. When deployment finishes, Render gives a frontend URL similar to:

```text
https://hireswarm-web.onrender.com
```

That is the only link to share with the team.

## 3. Live acceptance test

Open the frontend URL in an incognito/private browser:

1. Wait for **Live workspace**.
2. Open **Guide**.
3. Open **Roles** and search `Python`.
4. Add a live role or use **Paste**.
5. Run a rehearsal.
6. Confirm Review still requires explicit approval before DOCX/PDF exports unlock.

If the service was idle, open `https://YOUR-API/healthz`, wait for JSON, then reload the frontend. Free web services can sleep and wake on a new request.

## Operational notes

- Every push to `main` can trigger deployments for connected services.
- The current $0 backend uses volatile in-memory run state; a service restart clears active/manual session data.
- Keep `USE_CREWAI=false` until you deliberately add a free Groq/Gemini key in the **backend Render service environment**, never in GitHub or the frontend.
- Do not set `NEXT_PUBLIC_API_BASE` for this route. The frontend should use its same-origin `/backend` rewrite.
