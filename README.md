# A-Level Terminal on Cloudflare Pages

The tracker as a website on Cloudflare Pages. His progress saves to a free Cloudflare database, so his phone and laptop always show the same ticks. Nothing has to run on your computer.

| In this folder | What it is |
|---|---|
| `public/index.html` | The tracker |
| `public/_headers` | Keeps the site out of search engines |
| `functions/api/[[path]].js` | Saves his progress in the database |
| `README.md` | These steps |

It takes about 10 minutes. You need a GitHub account and a free Cloudflare account.

---

## Part 1: Put the files on GitHub

1. Unzip `a-level-terminal-cloudflare-pages.zip`. You get a folder with `README.md`, `functions` and `public` inside.
2. On GitHub, click **+** (top right) → **New repository**. Name it `a-level-terminal`. **Private** is fine. Click **Create repository**.
3. On the new, empty repository page, click the link **uploading an existing file**.
4. Open the unzipped folder, select everything inside it (`README.md`, `functions`, `public`) and drag it all onto the GitHub page.
   - Drag the three items, not the zip and not the outer folder.
   - Drag rather than using "choose your files", because the file picker can't upload folders.
5. Click **Commit changes**.
6. Check the repository's front page lists `functions`, `public` and `README.md`, and that `functions` → `api` contains `[[path]].js`.

## Part 2: Make the database

7. In the Cloudflare dashboard, open **D1 SQL database** (in the left menu, under Storage & databases) → **Create Database**. Name it `a-level-terminal` → **Create**.

You don't need to add any tables; the site creates them the first time it runs.

## Part 3: Create the site

8. Go to **Workers & Pages** → **Create application** → **Pages** → **Connect to Git** (it may say *Import an existing Git repository*). Choose **GitHub**, sign in, **Install & Authorize**, pick the `a-level-terminal` repository, then **Begin setup**.
9. On **Set up builds and deployments** enter:

   | Setting | Value |
   |---|---|
   | Project name | `a-level-terminal` (this becomes the link) |
   | Production branch | `main` |
   | Framework preset | `None` |
   | Build command | *leave empty* |
   | Build output directory | `public` |

   Click **Save and Deploy**, wait for **Success**, then go to the project.

## Part 4: Connect the database (this is what keeps his devices in sync)

10. In the project, go to **Settings** → **Bindings** → **Add** → **D1 database bindings**.
    - **Variable name:** `DB` (capital letters)
    - **D1 database:** `a-level-terminal`
    - Click **Save**. If it asks which environment, choose **Production**.
11. Go to the **Deployments** tab. On the newest deployment click **⋯** → **Retry deployment**, and wait for **Success**. The database only connects on a new deployment.

## Part 5: Check it and send it

12. Open your link, e.g. `https://a-level-terminal.pages.dev` (it's shown on the project page). The top right of the tracker should say **SYNCED**.
    - If it says **THIS DEVICE** and the page shows "Nearly set up", the database isn't connected yet. Check step 10 (the name must be exactly `DB`), then do step 11 again.
13. Send him the link. On his phone he can tap **Share → Add to Home Screen** so it opens like an app.

---

## Good to know

- **Updating it later:** upload changed files to the repository (**Add file → Upload files**) and Cloudflare redeploys by itself within a minute or two.
- **No passcode:** anyone who has the link can open the tracker and change his progress, so only send it to him. If you ever want a passcode: **Settings → Variables and Secrets → Add**, name `PASSCODE`, any value, **Save**, then do step 11 again. The tracker will ask for it once on each device.
- **Backups:** Cloudflare keeps 7 days of history for the database (D1 Time Travel), and he can download a backup any time from the tracker's **setup** tab.
- **Cost:** free. One student is nowhere near the free limits.
- Casper's **Get feedback from Claude** button only works inside Claude. On this version he uses the self-check list after each answer.
