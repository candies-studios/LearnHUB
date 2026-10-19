# LearnHub — HR learning management platform

A self-hosted learning platform in the spirit of SAP SuccessFactors Learning: employee accounts, a course catalog, assigned training with due dates, timed exams, SCORM playback, results and reports, and verifiable certificates that expire for recertification.

It doesn't depend on any npm packages. Everything runs on plain Node.js.

## Two ways to run it

| | **Server version** (`node server.js`, Render, etc.) | **GitHub Pages demo** (`index.html` at the repository root) |
|---|---|---|
| Where data is stored | One shared database on the server | Only in each visitor's own browser |
| HR sees every employee's results | ✅ | ❌ each device has its own separate copy |
| Import SCORM packages | ✅ | ❌ (the Chiller package comes pre-installed) |
| Cost | Hosting needed | Free |

Both use the same screens and the same logic (`lib/routes.js`). The Pages build is `pages/learnhub-local.js`. If you change anything in `lib/`, regenerate it with `node scripts/build-pages.js`.

**Demo sign-ins** (Pages): Admin `admin@company.local` / `Admin123!`; Manager `anita.rao@example.com` / `Welcome123!`; Employee `rahul.verma@example.com` / `Welcome123!`. The sign-in page also has one-click links for each. **Settings → Reset demo data** restores the starting state.

## Start it (server version)

1. Install **Node.js 18 or newer** from https://nodejs.org (one-time).
2. **Mac:** double-click `start.command`. If macOS blocks it the first time, right-click → Open.
   **Windows:** double-click `start.bat`.
   **Any OS:** open a terminal in this folder and run `node server.js`.
3. The app opens at **http://localhost:3000**.

| Account | Email | Password |
|---|---|---|
| Administrator | `admin@company.local` | `ChangeMe123!` (you choose a new one at first sign-in) |
| Demo manager | `anita.rao@example.com` | `Welcome123!` |
| Demo employees | `rahul.verma@example.com`, `sneha.kulkarni@example.com`, `imran.shaikh@example.com`, `kavya.nair@example.com`, `deepak.joshi@example.com` | `Welcome123!` |

The demo accounts are there so the dashboards have people in them. Deactivate them on the Employees page when you load your real staff.

**Colleagues on the same network** can use it at `http://<this computer's IP>:3000`. To change the port, run `PORT=8080 node server.js`.

## What's included

**Employees and roles**
- **Admin:** manages everything.
- **Manager:** sees their direct reports' progress, assigns training to them and can grant extra exam attempts.
- **Employee:** takes training.
- Employee profile fields: employee ID, department, job title, location, manager and hire date.
- Bulk CSV import and export. New accounts get temporary passwords, the first sign-in forces a password change, and admins can reset passwords.

**Courses**
- **Native courses** are built in the browser from four kinds of module:
  - videos, with an optional "no skipping" mode
  - reading pages (simple markdown)
  - PDFs and other documents
  - external links

  Modules can unlock in order. Each course has its own catalog visibility and self-enrol setting.
- **SCORM 1.2 and 2004 packages:** upload the .zip. LearnHub runs the SCORM API and records each part's status, score and bookmark.
- Draft, published and archived states. Archived courses keep their records and certificates.

**Exams**
- **Question types:** single answer, multiple answer, and true/false. Questions can be worth different numbers of points and carry an explanation.
- **Rules:**
  - pass mark and time limit (enforced on the server)
  - maximum attempts
  - a random draw of N questions from a larger bank
  - shuffled questions and shuffled options
- **Answer review:** choose what learners see afterwards: correct answers always, correct answers only after passing, or score only.
- **Learner experience:** autosave, resume, flag-for-review and automatic submission when time runs out.
- Bulk-add questions from a CSV file.
- Every attempt keeps a snapshot of the questions as they were asked, so editing an exam later doesn't change past results.

**Assignments and tracking**
- **Assign training** to people or whole departments, with a due date and a required/optional flag.
- **Recertification:** an assignment can reset people who already completed the course, so they take it again.
- **Status tracking:** overdue items are flagged.
- **Corrections:**
  - grant an extra exam attempt
  - change a due date
  - record a completion manually (classroom or on-the-job training)
  - remove an enrollment

**Results and reports**
- **Dashboard:**
  - completion rate, overdue count, exam pass rate and certificate health
  - breakdowns by course and by department
  - recent results
  - lists of overdue items and certificates due for renewal
- Every exam attempt can be opened with the employee's answers. Employees have their own transcript.
- CSV exports for employees, enrollments and exam results.

**Certificates**
- Issued automatically when someone completes a course, with an optional validity period in months.
- Printable A4 landscape layout: open a certificate and use Print → Save as PDF.
- Each certificate has a public verification page at `/cert/<ID>`. Admins can revoke a certificate.

**Other**
- Audit log.
- Organisation name, brand colour and certificate signatory settings.
- Automatic daily database backups.

## Your Chiller & Lockout content

`scripts/seed-chiller.js` loaded two courses from your folder:

1. **Chiller SOP and Lockout Process (SCORM).** Your original package, imported unchanged apart from one fix noted below.
2. **Chiller Lock-out Safety Certification (native).**
   - Contents: the same two videos (no skipping), a page of key safety points, and a 15-question exam built from your quiz.
   - Exam rules: 80% to pass, 20 minutes, 3 attempts.
   - Certificate: valid for 12 months.

To import another SCORM package, use Courses & exams → Import SCORM package in the app, or run `node scripts/import-scorm.js "/path/to/folder-or.zip"`.

## Where data lives

```
data/db.json          people, courses, exams, enrollments, attempts, certificates, audit log
data/content/         uploaded videos and documents, and unpacked SCORM packages
data/backups/         one copy of db.json per day (last 14 kept)
```

To back up, copy the whole `data` folder. To start over, stop the server and delete `data`.

## Putting it online

To run it on the internet with GitHub and Render, see **[DEPLOY.md](DEPLOY.md)**. For a hosted deployment, set `LH_ADMIN_EMAIL`, `LH_ADMIN_PASSWORD` and `LH_DATA` (the persistent disk path).

## Before you run it company-wide

- **HTTPS:** put it behind HTTPS, for example Nginx, Caddy or Cloudflare Tunnel in front of port 3000. Don't expose plain HTTP to the internet.
- **Database:** the JSON store suits up to a few thousand employees. Beyond that, move `lib/db.js` to PostgreSQL or SQLite. The rest of the code only uses the `db` arrays.
- **Not included yet:**
  - single sign-on (SAML or Azure AD)
  - email reminders for due dates and expiring certificates
  - xAPI/LRS
  - instructor-led session scheduling

  These are the natural next modules.
