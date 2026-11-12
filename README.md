# Secret Santa Organizer

COMP 3962 Cloud Computing Platforms group project. A web app for running Secret Santa gift exchanges built locally first and then deployed to AWS.

| Feature | Status | AWS services |
|---|---|---|
  | **A: Groups & Wishlists** | TODO, see `src/features/groups/routes.js` | RDS (PostgreSQL), S3, SES |
  | **B: The Draw & Reminders** | TODO, see `src/features/draw/routes.js` | SES, EventBridge Scheduler |
| **C: Anonymous Hints & Gift Reveal** | working locally | S3, EC2 / Elastic Beanstalk, CloudWatch |

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

They're all in the group "BCIT Squad Gift Exchange". Alpha is the organizer, and the draw is already done (Alpha -> Bravo -> Charlie -> Delta -> Alpha) so features that depend on the draw can be tested independently.

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
  features/
    groups/routes.js       - A (TODO)
    draw/routes.js         - B (TODO)
    hints/routes.js        - C
views/
  partials/header.ejs      - top of every page (logged in bar, error message)
  partials/footer.ejs      - bottom of every page
  partials/thread.ejs      - C, one chat thread
  login.ejs                - login page
  home.ejs                 - my groups
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

**C: Anonymous Hints & Gift Reveal**
| Method | Route | |
|---|---|---|
| GET | `/groups/:id/hints` | hints page, both my threads (Santa's name stays hidden until the reveal) |
| POST | `/groups/:id/hints` | Santa sends hint to giftee, form field body |
| POST | `/groups/:id/hints/reply` | giftee replies to Santa, form field body |
| GET | `/groups/:id/reveal` | reveal page, plus who had who and the photo wall once revealed |
| POST | `/groups/:id/reveal` | organizer reveals everyone |
| POST | `/groups/:id/photos` | upload (form fields photo, caption), after reveal only |

Feature C reads from the assignments table that Feature B fills in, so please keep its columns as (id, group_id, giver_id, receiver_id).