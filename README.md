# Secret Santa Organizer

COMP 3962 Cloud Computing Platforms group project. A web app for running Secret Santa gift exchanges built locally first and then deployed to AWS.

| Feature | Status | AWS services |
|---|---|---|
| **A: Groups & Wishlists** | working locally | RDS (PostgreSQL), S3, SES |
| **B: The Draw & Reminders** | working locally | SES, EventBridge Scheduler |
| **C: Anonymous Hints & Gift Reveal** | working locally | S3, SES |

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

All four are in two groups, and Alpha is the organizer of both:
- **BCIT Squad Gift Exchange** (code `111111`): names are already drawn (Alpha -> Bravo -> Charlie -> Delta -> Alpha), so hints and the reveal can be tested straight away.

Emails (invites, draw picks, hint notifications) and reminders print in the terminal while running locally.

---

## Project layout

```
src/
  app.js                   - wires everything together
  auth.js                  - login/logout + requireLogin (req.user) + requireMember (req.group)
  db/
    schema.sql             - ALL tables (shared)
    setup.js               - builds tables + seed data
    pool.js                - postgres connection (bundled postgres now, RDS later)
    local-db.js            - starts the bundled postgres
    reset.js               - npm run db:reset
  services/
    storage.js             - photo storage: local /uploads now, S3 later
    email.js               - every email goes through send(): printed in the terminal now, SES later
    reminders.js           - reminder emails: printed in the terminal now, EventBridge Scheduler later
  features/
    groups/routes.js       - A (+ home page)
    draw/routes.js         - B
    hints/routes.js        - C
views/
  partials/header.ejs      - top of every page (logged in bar, error message)
  partials/footer.ejs      - bottom of every page
  partials/thread.ejs      - C, one chat thread
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
| GET | `/` | home page, my groups + create and join forms |
| POST | `/groups` | create a group, form fields name, budget, exchange_date (has to be after today) |
| POST | `/groups/join` | join with form field code, blocked once names are drawn |
| GET | `/groups/:id` | group page: details, join code, members and their wishlists |
| POST | `/groups/:id/wishlist` | add to my wishlist, form fields title, link, photo (optional) |
| POST | `/groups/:id/wishlist/:itemId/delete` | remove one of my own wishlist items |
| POST | `/groups/:id/invite` | email someone the join code, form field email (before the draw only) |

**B: The Draw & Reminders**
| Method | Route | |
|---|---|---|
| GET | `/groups/:id/draw` | who did you draw + their wishlist (organizer can draw from here too) |
| POST | `/groups/:id/draw` | organizer only, 3+ people: shuffle, save pairs, email everyone their pick, schedule a reminder 3 days before |

**C: Anonymous Hints & Gift Reveal**
| Method | Route | |
|---|---|---|
| GET | `/groups/:id/hints` | hints page, both my threads (Santa's name stays hidden until the reveal) |
| POST | `/groups/:id/hints` | Santa sends hint to giftee, form field body, emails the giftee (without the Santa's name) |
| POST | `/groups/:id/hints/reply` | giftee replies to Santa, form field body, emails the Santa |
| GET | `/groups/:id/reveal` | reveal page, plus who had who and the photo wall once revealed |
| POST | `/groups/:id/reveal` | organizer reveals everyone |
| POST | `/groups/:id/photos` | upload (form fields photo, caption), after reveal only |

Feature C reads from the assignments table that Feature B fills in, so please keep its columns as (id, group_id, giver_id, receiver_id).

Switching to AWS later: set `EMAIL_DRIVER`, `REMINDER_DRIVER` and `STORAGE_DRIVER` to `aws` in `.env` once SES, EventBridge Scheduler and S3 are set up.
