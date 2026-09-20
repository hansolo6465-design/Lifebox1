# LifeBox 📦

Warranties, belongings, subscriptions and reminders in one private dashboard.

## Run it on your computer
Requires Node.js 20.12 or newer.

```bash
npm install
npm start
```
Open http://localhost:3000 and create an account.

## What's inside
| Feature | Where |
|---|---|
| Register / log in / log out | `server.js` (`/api/auth/*`), passwords hashed with bcrypt, sessions in HttpOnly cookies |
| Dashboard, belongings, warranties, subscriptions, reminders, settings | `views/dashboard.html`, `public/app.js`, `public/app.css` |
| Landing page + contact form | `public/index.html`, `public/style.css`, `public/script.js` |
| Database | SQLite file at `data/lifebox.db` (created automatically) |

Every record is tied to the logged-in user on the server, so accounts can never see each other's data.

## Contact form
Messages are always saved to the database. Read them with:
```bash
npm run messages
```
To also receive each one by email, copy `.env.example` to `.env` and fill in `OWNER_EMAIL` and the `SMTP_*` values (Gmail works with an App Password).

## Put it online
This app needs a host that runs Node.js **and keeps a disk** (the database is a file).
Good fits: Render (add a Disk), Railway (add a Volume), Fly.io (Volume), or any VPS.
Serverless hosts like Vercel or Netlify will NOT keep the SQLite file.

Set these environment variables on the host:
- `NODE_ENV=production`
- `TRUST_PROXY=1`
- `DATA_DIR=` the path of your persistent disk
- `OWNER_EMAIL`, `SMTP_*` (optional, for email delivery)

Start command: `npm start`. Back up the `data/` folder regularly.
