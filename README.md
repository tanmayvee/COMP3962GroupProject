# Secret Santa Organizer

COMP 3962 Cloud Computing Platforms group project. A web app for running Secret Santa gift exchanges built locally first and then deployed to AWS.

| Feature | Status | AWS services |
|---|---|---|
| **A: Groups & Wishlists** | ready for AWS | RDS (PostgreSQL), S3, SES |
| **B: The Draw & Reminders** | ready for AWS | SES, EventBridge Scheduler |
| **C: Anonymous Hints & Gift Reveal** | ready for AWS | S3, SES |

The whole app is hosted on EC2.

---

## Getting it running

Postgres is bundled so you don't need to install it separately. The app runs on `http://localhost:3000` and the database on `localhost:5433`.

```bash
git clone https://github.com/tanmayvee/COMP3962GroupProject.git
cd COMP3962GroupProject
npm install
cp .env.example .env
npm run dev
```

The first `npm run dev` sets up the database, creates the tables and adds seed data. It takes a few seconds and only happens once. Data is kept in `.localdb/` (not committed). Ctrl+C stops the app and the database together.

### Test accounts
`alpha@example.com`, `bravo@example.com`, `charlie@example.com`, `delta@example.com`. The password for all of them is `password123`.

On AWS the SES sandbox only emails verified addresses, so set `SEED_EMAILS` in `.env` to 4 real inboxes before `npm run db:reset` and the test accounts use those instead (the login page shows whichever emails are in use).

All four are in the seed group, and Alpha is the organizer:
- **BCIT Squad Gift Exchange** (code `111111`): names are already drawn (Alpha -> Bravo -> Charlie -> Delta -> Alpha), so hints and the reveal can be tested straight away.

Emails (invites, draw picks, hint notifications) and reminders print in the terminal while running locally. Logins are stored in Postgres, so restarting the app doesn't log you out.

---

## Project layout

```
src/
  app.js                   - wires everything together
  auth.js                  - login/logout + requireLogin (req.user) + requireMember (req.group)
  db/
    schema.sql             - ALL tables (shared)
    setup.js               - builds tables + seed data
    pool.js                - postgres connection (bundled postgres locally, RDS on AWS)
    seed-accounts.js       - the 4 test accounts (emails can come from SEED_EMAILS)
    local-db.js            - starts the bundled postgres
    reset.js               - npm run db:reset
  services/
    storage.js             - photo storage: local /uploads or S3
    email.js               - every email goes through send(): printed in the terminal or sent with SES
    reminders.js           - reminder emails: printed in the terminal or scheduled with EventBridge Scheduler
  features/
    groups/routes.js       - A (+ home page)
    draw/routes.js         - B
    hints/routes.js        - C
views/
  partials/header.ejs      - top of every page (nav bar, error / success messages)
  partials/footer.ejs      - bottom of every page (fades success messages out after 4 seconds)
  partials/thread.ejs      - C, one chat thread
  landing.ejs              - what logged out visitors see at /
  login.ejs                - login page
  home.ejs                 - A, my groups + create / join
  group.ejs                - A, group page
  draw.ejs                 - B, who did you draw
  error.ejs                - not found / something broke
  hints.ejs                - C
  reveal.ejs               - C
public/
  style.css                - shared styling
```
---

## Messages

Routes can leave a one-time message for the next page: `req.session.error = '...'` shows a red message that stays until it's closed, and `req.session.notice = '...'` shows a green one that fades out after a few seconds.

---

## Routes

`:id` = group id. Everything except login needs you to be logged in, otherwise you get sent to `/login`.

**Login**
| Method | Route | |
|---|---|---|
| GET | `/login` | login page |
| POST | `/login` | form fields email, password |
| POST | `/logout` | |

**A: Groups & Wishlists**
| Method | Route | |
|---|---|---|
| GET | `/` | landing page if logged out, otherwise my groups + create and join forms |
| POST | `/groups` | create a group, form fields name, budget, exchange_date (has to be after today) |
| POST | `/groups/join` | join with form field code, blocked once names are drawn |
| GET | `/groups/:id` | group page: details, join code, members and their wishlists |
| POST | `/groups/:id/wishlist` | add to my wishlist, form fields title, link, photo (optional) |
| POST | `/groups/:id/wishlist/:itemId/delete` | remove one of my own wishlist items |
| POST | `/groups/:id/invite` | email someone the join code, form field email (before the draw only) |
| POST | `/groups/:id/edit` | organizer only, change name, budget, exchange_date (moves the reminder if names are drawn) |
| POST | `/groups/:id/delete` | organizer only, deletes the group and everything in it |
| POST | `/groups/:id/leave` | anyone but the organizer, before names are drawn (takes your wishlist with you) |

**B: The Draw & Reminders**
| Method | Route | |
|---|---|---|
| GET | `/groups/:id/draw` | who did you draw + their wishlist (organizer can draw from here too) |
| POST | `/groups/:id/draw` | organizer only, 3+ people: shuffle, save pairs, email everyone their pick, schedule a reminder 3 days before |
| POST | `/groups/:id/remind` | organizer only, after the draw: sends everyone the reminder right now (same email as the scheduled one, handy for demos) |

**C: Anonymous Hints & Gift Reveal**
| Method | Route | |
|---|---|---|
| GET | `/groups/:id/hints` | hints page, both my threads (Santa's name stays hidden until the reveal) |
| POST | `/groups/:id/hints` | Santa sends hint to giftee, form field body, emails the giftee (without the Santa's name) |
| POST | `/groups/:id/hints/reply` | giftee replies to Santa, form field body, emails the Santa |
| GET | `/groups/:id/reveal` | reveal page, plus who had who and the photo wall once revealed |
| POST | `/groups/:id/reveal` | organizer reveals everyone |
| POST | `/groups/:id/photos` | upload (form fields photo, caption), after reveal only |

---

## Local vs AWS

The code is the same in both places, `.env` decides which services get used:

| Setting | Local | AWS |
|---|---|---|
| `DB_MODE` | `embedded` (bundled postgres) | `external` (RDS, connects over SSL) |
| `STORAGE_DRIVER` | `local` (`/uploads`) | `aws` (private S3 bucket, presigned links) |
| `EMAIL_DRIVER` | `local` (printed) | `aws` (SES) |
| `REMINDER_DRIVER` | `local` (printed) | `aws` (one EventBridge schedule per Santa, sends through SES) |

There are no AWS access keys in the app or in `.env`. On EC2 the SDK uses the instance's IAM role.
