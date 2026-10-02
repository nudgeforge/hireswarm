# HireSwarm: GitHub se live team link tak

Ye project **GitHub Pages** par deploy nahi hona chahiye, kyun ke HireSwarm mein Next.js frontend ke saath FastAPI API aur SSE interview stream bhi hai. Recommended $0 demo architecture:

```text
Team browser
  ↓
Vercel — Next.js frontend (the one link you share)
  ↓ /backend rewrite
Render — FastAPI / SSE API
  ↓
public job feeds + in-memory evidence workflow
```

Deploy order hamesha: **GitHub → Render backend → Vercel frontend → live test**.

---

## 0. Before you begin

You need:

- a GitHub account;
- a Render account, connected to GitHub;
- a Vercel account, connected to GitHub;
- Git installed locally;
- this project folder, `hireswarm/`.

No Groq/Gemini key is needed for the default deterministic Evidence Lab. Start with `USE_CREWAI=false`.

### Important product behaviour

The starter backend intentionally keeps runs and manually pasted roles in volatile memory. A Render free-instance restart/sleep can clear an in-progress run. For a team demo, start a fresh role/rehearsal after a cold start and do not treat this starter as a long-term personal-data store.

Never commit `.env`, API keys, a real CV, or a downloaded application packet. The repository `.gitignore` already excludes local environment files, Node modules, build output, and local browser-audit artifacts.

---

## 1. Put the project on GitHub

### A. Create an empty GitHub repository

1. Log in at <https://github.com>.
2. Click **+** → **New repository**.
3. Name it something like `hireswarm`.
4. Choose **Private** while testing with your team. You can make it public later if desired.
5. Do **not** tick “Add a README”, `.gitignore`, or license; this project already has them.
6. Click **Create repository**.
7. Copy the HTTPS repository URL shown by GitHub, for example:

```text
https://github.com/YOUR-USERNAME/hireswarm.git
```

### B. Push this folder

Open a terminal in the project root and run:

```bash
cd /path/to/hireswarm

git init
git add .
git status
git commit -m "Initial HireSwarm deployment"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/hireswarm.git
git push -u origin main
```

On the first `git push`, GitHub may open a browser window to authenticate. Complete that step, then return to the terminal.

### C. Check GitHub before deploying

Open the repository in GitHub and confirm these paths exist:

```text
backend/app/main.py
backend/requirements.txt
frontend/app/page.tsx
frontend/app/usability-fix.css
frontend/package.json
render.yaml
```

Confirm that no `.env` file, secret key, real CV, `node_modules`, or `.next` folder appears in GitHub.

---

## 2. Deploy the FastAPI backend on Render

The repository already contains `render.yaml`, so the easiest route is a Render Blueprint.

### A. Create the service

1. Go to <https://dashboard.render.com>.
2. Click **New** → **Blueprint**.
3. Connect GitHub if prompted and select the `hireswarm` repository.
4. Render should detect `render.yaml` at repository root.
5. Review the detected service:

| Render field | Correct value |
|---|---|
| Name | `hireswarm-api` (or another unique name) |
| Service type | Web Service |
| Runtime | Python |
| Root directory | `backend` |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health check | `/healthz` |
| Environment variable | `USE_CREWAI=false` |

6. Choose the available **Free** plan if you are using the no-cost route.
7. Click **Apply** / **Create Blueprint** and wait for the deployment log to show success.

### B. Copy and verify the backend URL

Render will give a URL similar to:

```text
https://hireswarm-api.onrender.com
```

Open this in a browser with `/healthz`:

```text
https://hireswarm-api.onrender.com/healthz
```

You should see JSON containing:

```json
{"ok": true, "service": "HireSwarm Evidence Lab", ...}
```

Save the URL **without** `/healthz`; Vercel needs the API base:

```text
https://hireswarm-api.onrender.com
```

### C. Optional AI provider configuration

For the first deployment, leave `USE_CREWAI=false`. The default Evidence Lab is fully functional without an API key.

If you later add a free Groq or Gemini key:

1. In Render open the API service → **Environment**.
2. Add `GROQ_API_KEY` or `GEMINI_API_KEY` there only.
3. Set `USE_CREWAI=true` only after testing the provider.
4. Never place these keys in GitHub or a `NEXT_PUBLIC_*` Vercel variable.

---

## 3. Deploy the Next.js frontend on Vercel

### A. Import the repository

1. Go to <https://vercel.com/new>.
2. Click **Import Git Repository** and select `hireswarm`.
3. In **Configure Project**, set:

| Vercel field | Correct value |
|---|---|
| Framework Preset | Next.js |
| Root Directory | `frontend` |
| Install Command | leave automatic, or use `npm ci` |
| Build Command | leave automatic, or use `npm run build` |
| Output Directory | leave empty / default |

### B. Set the crucial environment variable

Before clicking Deploy, open **Environment Variables** and add:

| Name | Value | Environments |
|---|---|---|
| `BACKEND_URL` | `https://YOUR-RENDER-SERVICE.onrender.com` | Production, Preview, Development |

Replace the value with your Render URL exactly, with no trailing `/healthz`.

**Do not set `NEXT_PUBLIC_API_BASE` for this recommended setup.** Leave it unset/blank. The app will call `/backend/...`; Vercel’s Next.js rewrite forwards that path to Render. This keeps browser calls same-origin and avoids exposing a localhost URL or needing a separate CORS setup.

### C. Deploy

1. Click **Deploy**.
2. Wait for the Vercel build to finish.
3. Vercel displays a production URL similar to:

```text
https://hireswarm.vercel.app
```

That is the **single link** to share with your team.

Every future push to `main` triggers a new production deployment. Pull requests can receive separate Preview URLs.

---

## 4. First live smoke test — do this before sharing

Open your Vercel URL in an incognito/private browser and test in this order:

1. Wait until the top status says **Live workspace**.
   - On a free Render instance, first wake-up can take roughly a minute after inactivity.
2. Click **Guide**; verify the modal opens and closes.
3. Click **Roles** → search `Python` → **Find live roles**.
4. Select a live result or click **Paste** and add a copied public job description.
5. Confirm the target badge says **Live public listing** or **Pasted by you**, never practice fixture for a real run.
6. Click **Run focused rehearsal**.
7. Wait for Match → Rehearse → Tailor → Review.
8. Check **Read cover letter**.
9. Click **I've reviewed this packet**.
10. Verify `.docx` and **Printable PDF** downloads unlock only afterward.

If all ten pass, share the Vercel URL, not the Render API URL.

---

## 5. Share with your team

Send a short message like:

> Team, please test HireSwarm here: `https://YOUR-PROJECT.vercel.app`  
> Start with Guide, then use Roles or Paste to bring a target. It is evidence-first and will never auto-apply. The first click after idle can take a little longer while the free API wakes up.

For a private GitHub repo, your team does **not** need GitHub access merely to use the Vercel public link. They only need GitHub access if they will review code or push changes.

---

## 6. Every update after today

Make your changes locally, then:

```bash
cd /path/to/hireswarm
git add .
git commit -m "Describe the improvement"
git push origin main
```

Then:

- Render automatically redeploys the backend when backend/root files change.
- Vercel automatically redeploys the frontend when `frontend/` changes.
- Open the Vercel dashboard deployment log if a build fails.

For safer team review, use a branch and pull request:

```bash
git checkout -b fix/mobile-navigation
# make changes
git add .
git commit -m "Improve mobile navigation"
git push -u origin fix/mobile-navigation
```

Open a GitHub Pull Request. Vercel will normally create a Preview URL for the team to test before merge.

---

## 7. Common deployment problems

### Vercel page loads but actions say service unavailable

Check, in order:

1. Render URL + `/healthz` returns JSON.
2. Vercel `BACKEND_URL` has the correct HTTPS Render URL.
3. `NEXT_PUBLIC_API_BASE` is not set to `localhost`, `127.0.0.1`, or a wrong URL.
4. Redeploy Vercel after changing environment variables.

### Render works locally but deployment fails

Check Render service settings match this project exactly:

```text
Root directory: backend
Build: pip install -r requirements.txt
Start: uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Also inspect the Render build logs; do not use `localhost` or a fixed port in the start command.

### First request is slow

This is normal on a sleeping free Render web service. Open `/healthz`, wait for the JSON response, then reload Vercel once. For a judge/team demo, warm the API a minute before presenting.

### Vercel build points to the wrong folder

Set **Root Directory = `frontend`**. Do not use the repository root for this monorepo frontend project.

### Team says a previous run disappeared

The current $0 starter uses volatile in-memory run state. A restart clears ephemeral runs. This is expected until persistent storage/auth is enabled. Never use this demo deployment as the only store of a real CV or application history.

---

## 8. What link goes where?

| Link | Who uses it? | Example |
|---|---|---|
| GitHub repository | Developers/reviewers | `github.com/you/hireswarm` |
| Render API URL | Infrastructure + Vercel only | `hireswarm-api.onrender.com` |
| Vercel URL | Your team/testers | `hireswarm.vercel.app` |

For normal team testing, share only the **Vercel URL**.
