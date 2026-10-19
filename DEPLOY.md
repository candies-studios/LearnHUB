# Putting LearnHub online (GitHub + Render)

When you're done, LearnHub runs 24/7 at an `https://…onrender.com` address that opens on any phone, tablet or computer. GitHub holds the code. Render runs it and keeps the data on a disk.

> **Your data never goes to GitHub.** The `.gitignore` file keeps the `data/` folder (employees, passwords, results, videos) out of the repository.

---

## Step 1 — Put the code on GitHub

**Option A: in the browser (no tools needed)**

1. Sign in at https://github.com and click **New repository**.
2. Name it `learnhub`, choose **Private**, and click **Create repository**.
3. On the empty repository page, click **uploading an existing file**.
4. Open the LearnHub folder in Finder and select everything **except the `data` folder**. Press ⌘⇧. (Command-Shift-full stop) so the hidden files `.gitignore` and `.dockerignore` show up, and include them too.
5. Drag the selection onto the GitHub page, then click **Commit changes**.

**Option B: from Terminal (if you use git)**

```bash
cd ~/Downloads/LearnHub
git init
git add .
git commit -m "LearnHub learning platform"
git branch -M main
git remote add origin https://github.com/<your-username>/learnhub.git
git push -u origin main
```

Run `git status` before committing. The `data` folder must **not** appear in the list.

The repository should contain:

```
.dockerignore  .gitignore  DEPLOY.md  Dockerfile  README.md  package.json  render.yaml
server.js  start.bat  start.command  lib/  public/  scripts/
```

---

## Step 2 — Deploy on Render

1. Sign up at https://render.com using **Sign in with GitHub**, and allow it to see your `learnhub` repository.
2. Click **New → Blueprint** and pick the `learnhub` repository. Render reads `render.yaml` and sets up:
   - a web service on the **Starter** plan
   - a 5 GB persistent disk mounted at `/var/data`
   - the Singapore region
3. It asks for two values:
   - **LH_ADMIN_EMAIL**: your admin email, for example `hr@yourcompany.com`
   - **LH_ADMIN_PASSWORD**: a strong password (12+ characters). This becomes the admin password on first start.
4. Click **Apply**. The first deploy takes a minute or two.
5. Open the address Render shows (`https://learnhub-xxxx.onrender.com`) and sign in with the admin email and password from step 3.

> A persistent disk needs a paid plan. On a free plan everything you add is wiped whenever the service restarts. Check Render's pricing page for current costs.

---

## Step 3 — Load your content

1. **Branding:** go to **Settings** and set your organisation name, brand colour and certificate signatory.
2. **Courses:**
   - Zip your `chiller and lockout` folder. In Finder, right-click it and choose **Compress**.
   - In LearnHub, go to **Courses & exams → Import SCORM package** and upload the zip.
   - This creates **both** courses: the original SCORM course, and the **Chiller Lock-out Safety Certification** with its 15-question exam (it reuses the same videos).
   - If the upload fails because the file is too big (the videos are about 120 MB), make the videos smaller with a free tool such as HandBrake, zip again, and retry.
3. **Employees:** go to **Employees → Import CSV** and upload your staff list. Download the temporary passwords it gives you and send them out.
4. **Training:** go to **Assignments → Assign training**, pick a course and the people or departments, and set a due date.

Share the Render address with employees. On phones and tablets they can use **Add to Home Screen** to get an app icon.

---

## Updating LearnHub later

Change the files in GitHub (edit them in the browser, upload new versions, or `git push`). Render redeploys automatically. Your data on the disk is kept.

## Your own web address (optional)

In Render, open the service, go to **Settings → Custom Domains**, add `learning.yourcompany.com`, and create the DNS record Render shows you with whoever manages your domain. Render provides the HTTPS certificate for you.

## Backups

LearnHub saves a daily copy of its database to `/var/data/backups` (last 14 kept). For an off-site copy, download the CSV exports regularly from **Dashboard**, or use Render's disk snapshots.

---

## Other hosts

The included `Dockerfile` works on **Railway**, **Fly.io**, DigitalOcean App Platform or any server that runs Docker:

- Mount a persistent volume at **`/data`**.
- Set the `LH_ADMIN_EMAIL` and `LH_ADMIN_PASSWORD` environment variables.
- Expose port **3000**, or set `PORT` to whatever the host gives you.
