# Token Dine — Backend API

Backend server for the Token Dine restaurant management system.

- **Base URL:** `https://tokendinerestaurent.vercel.app`
- **Stack:** Node.js · Express · MongoDB (Atlas) · CORS · dotenv
- **Hosting:** Vercel

All responses are JSON. All IDs are MongoDB ObjectIds, returned to the client as a string `id` field (alongside `_id`).

---

## Roles

The system has three roles. Most admin-only screens on the frontend use the admin routes; managers/workers use a subset.

| Role     | Login URL                                                            | Identifier |
|----------|----------------------------------------------------------------------|------------|
| Admin    | `POST https://tokendinerestaurent.vercel.app/auth/login/admin`       | email      |
| Manager  | `POST https://tokendinerestaurent.vercel.app/auth/login/staff`       | mobile     |
| Worker   | `POST https://tokendinerestaurent.vercel.app/auth/login/staff`       | mobile     |

---

## Health & Root

| Method | URL                                                  | Use                                                       |
|--------|------------------------------------------------------|-----------------------------------------------------------|
| GET    | `https://tokendinerestaurent.vercel.app/`            | Returns `"Token Dine API running..."` — sanity check.     |
| GET    | `https://tokendinerestaurent.vercel.app/health`      | Returns `{ ok: true, time: <ISO> }` for uptime checks.    |

---

## AUTH

| Method | URL                                                              | Use                                                                                  |
|--------|------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| POST   | `https://tokendinerestaurent.vercel.app/auth/login/admin`        | Admin login by **email + password**. Rejects blocked accounts.                       |
| POST   | `https://tokendinerestaurent.vercel.app/auth/login/staff`        | Manager / worker login by **mobile + password**. Rejects blocked accounts.           |
| POST   | `https://tokendinerestaurent.vercel.app/auth/register`           | Create a new user account (any role). Sets status to `active`.                       |
| POST   | `https://tokendinerestaurent.vercel.app/auth/logout`             | Stateless logout — always returns `{ ok: true }`. Frontend just clears its session.  |

**Body shapes**
- Admin login: `{ email, password }`
- Staff login: `{ mobile, password }`
- Register: `{ name, mobile, email, password, role }`

---

## USERS  *(ADMIN)*

Manages admins, managers, and workers. Admin-only on the frontend.

| Method | URL                                                                  | Use                                                                                                       |
|--------|----------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| GET    | `https://tokendinerestaurent.vercel.app/users`                       | List users. Filters: `?role=admin\|manager\|worker`, `?q=<search name/mobile/email>`, `?page`, `?limit`.  |
| POST   | `https://tokendinerestaurent.vercel.app/users`                       | Create a new user (admin-driven creation, vs. self-register).                                             |
| GET    | `https://tokendinerestaurent.vercel.app/users/:id`                   | Get a single user by ID.                                                                                  |
| PATCH  | `https://tokendinerestaurent.vercel.app/users/:id`                   | Update user fields (name, mobile, email, password, role, etc.).                                           |
| PATCH  | `https://tokendinerestaurent.vercel.app/users/:id/status`            | Set `status` to `active` / `blocked`. Blocked users cannot log in.                                        |
| DELETE | `https://tokendinerestaurent.vercel.app/users/:id`                   | Permanently delete a user.                                                                                |

---

## CLIENTS

Restaurant customers who buy and spend tokens.

| Method | URL                                                                            | Use                                                                                                            |
|--------|--------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| GET    | `https://tokendinerestaurent.vercel.app/clients`                               | List clients. Filters: `?q=<name/mobile/nid>`, `?page`, `?limit`.                                              |
| POST   | `https://tokendinerestaurent.vercel.app/clients`                               | Register a new client. If `referral` matches an existing client's mobile, the referrer gets bonus tokens.      |
| GET    | `https://tokendinerestaurent.vercel.app/clients/:id`                           | Get a single client.                                                                                           |
| PATCH  | `https://tokendinerestaurent.vercel.app/clients/:id`                           | Update client info (name, mobile, NID, address, gender, rating, etc.).                                         |
| DELETE | `https://tokendinerestaurent.vercel.app/clients/:id`                           | Delete a client.                                                                                               |
| GET    | `https://tokendinerestaurent.vercel.app/clients/:id/purchases`                 | List a client's product purchases. Optional `?range=today\|week\|month`.                                       |
| POST   | `https://tokendinerestaurent.vercel.app/clients/:id/purchases`                 | Record a purchase: decrements stock, updates product status, deducts tokens, updates client balance.           |

**Referral bonus:** Controlled by the `REFERRAL_BONUS_TOKENS` env var (default `5`). Logged to `auditLogs`.

---

## PRODUCTS  *(ADMIN write)*

Menu items / stock.

| Method | URL                                                              | Use                                                                                                       |
|--------|------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| GET    | `https://tokendinerestaurent.vercel.app/products`                | List products. Filters: `?category=`, `?status=in-stock\|low-stock\|out-of-stock`.                        |
| POST   | `https://tokendinerestaurent.vercel.app/products`                | Add a new product (admin). Status is derived from stock automatically.                                    |
| PATCH  | `https://tokendinerestaurent.vercel.app/products/:id`            | Update a product. Updating `stock` re-derives `status`.                                                   |
| DELETE | `https://tokendinerestaurent.vercel.app/products/:id`            | Remove a product.                                                                                         |

**Status rules** (driven by `LOW_STOCK_THRESHOLD`, default `10`):
- `stock <= 0` → `out-of-stock`
- `stock < threshold` → `low-stock`
- otherwise → `in-stock`

---

## TOKEN SALES

Records of tokens sold to clients by workers.

| Method | URL                                                  | Use                                                                                                                            |
|--------|------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| GET    | `https://tokendinerestaurent.vercel.app/sales`       | List token sales. Filters: `?workerId=`, `?clientId=`, `?from=<date>`, `?to=<date>`.                                           |
| POST   | `https://tokendinerestaurent.vercel.app/sales`       | Record a sale: increments client `tokensBought` + `balance`, and the worker's `tokensSold`. Body: `{ clientId, workerId, tokens, amount }`. |

---

## ATTENDANCE

Worker check-ins.

| Method | URL                                                                       | Use                                                                                          |
|--------|---------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| GET    | `https://tokendinerestaurent.vercel.app/attendance`                       | List attendance records. Filters: `?workerId=`, `?date=<YYYY-MM-DD>`.                        |
| POST   | `https://tokendinerestaurent.vercel.app/attendance/checkin`               | Worker check-in. Auto-marks `late` if hour >= 10, else `present`. Body: `{ workerId }`.      |
| PATCH  | `https://tokendinerestaurent.vercel.app/attendance/:id/status`            | Override status (e.g. mark `absent`). Body: `{ status }`.                                    |

---

## COMPLAINTS

| Method | URL                                                                       | Use                                                                              |
|--------|---------------------------------------------------------------------------|----------------------------------------------------------------------------------|
| GET    | `https://tokendinerestaurent.vercel.app/complaints`                       | List complaints. Filter: `?status=open\|resolved\|...`.                          |
| POST   | `https://tokendinerestaurent.vercel.app/complaints`                       | File a complaint. Body: `{ byId, subject }`. Defaults `status` to `open`.        |
| PATCH  | `https://tokendinerestaurent.vercel.app/complaints/:id/status`            | Update complaint status. Body: `{ status }`.                                     |

---

## BONUSES  *(ADMIN)*

Worker bonuses. Each bonus increments `users.bonus` and writes an audit log.

| Method | URL                                                  | Use                                                                                          |
|--------|------------------------------------------------------|----------------------------------------------------------------------------------------------|
| GET    | `https://tokendinerestaurent.vercel.app/bonuses`     | List bonuses. Filter: `?workerId=`.                                                          |
| POST   | `https://tokendinerestaurent.vercel.app/bonuses`     | Grant a bonus. Body: `{ workerId, amount, reason }`.                                         |

---

## TABLES  *(ADMIN)*

Assign workers to tables.

| Method | URL                                                                  | Use                                                                                                    |
|--------|----------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| GET    | `https://tokendinerestaurent.vercel.app/tables`                      | List all table assignments, sorted by table number.                                                    |
| POST   | `https://tokendinerestaurent.vercel.app/tables/assign`               | Assign a worker to a table (upsert). Also sets the worker's `table` field. Body: `{ table, workerId }`.|
| POST   | `https://tokendinerestaurent.vercel.app/tables/release`              | Free a table. Clears `workerId` and marks it `free`. Body: `{ table }`.                                |

---

## DAILY PROGRESS

Per-worker daily report of tokens given vs. sold.

| Method | URL                                                      | Use                                                                                                            |
|--------|----------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| GET    | `https://tokendinerestaurent.vercel.app/progress`        | List progress entries. Filters: `?workerId=`, `?date=<YYYY-MM-DD>`.                                            |
| POST   | `https://tokendinerestaurent.vercel.app/progress`        | Submit a daily entry. Body: `{ workerId, table, tokenGiven, tokenSold, notes }`. Balance = given − sold.       |

---

## ANALYTICS  *(ADMIN dashboard)*

| Method | URL                                                                           | Use                                                                                                                                                          |
|--------|-------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| GET    | `https://tokendinerestaurent.vercel.app/analytics/overview`                   | Admin dashboard summary: revenue (total / day / week / month), tokens sold, active clients, low/out-of-stock count, referral count, and profit estimate.     |
| GET    | `https://tokendinerestaurent.vercel.app/analytics/worker/:id`                 | Per-worker stats: tokens sold, revenue generated, attendance rate (%), rating.                                                                               |

---

## DEV / SEED

| Method | URL                                                  | Use                                                                                                                                                |
|--------|------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| POST   | `https://tokendinerestaurent.vercel.app/seed`        | **Destructive.** Wipes `users`, `clients`, `products` and reinserts a default admin, 2 managers, 3 workers, and 5 sample products. Dev helper only.|

Default seeded credentials:
- **Admin:** `admin@restaurant.com` / `12345`
- **Manager:** mobile `01710000001` / `12345` (and `01710000002`)
- **Worker:** mobile `01810000001` / `12345` (and `01810000002`; `01810000003` is `blocked`)

---

## Environment variables

| Variable                  | Default                                    | Purpose                                            |
|---------------------------|--------------------------------------------|----------------------------------------------------|
| `PORT`                    | `5000`                                     | Server port (ignored on Vercel).                   |
| `MONGODB_URI`             | inline Atlas URI                           | MongoDB connection string.                         |
| `CORS_ORIGIN`             | `*`                                        | Allowed origin for CORS.                           |
| `REFERRAL_BONUS_TOKENS`   | `5`                                        | Tokens awarded to a referrer when their referee registers. |
| `LOW_STOCK_THRESHOLD`     | `10`                                       | Stock count below which a product is `low-stock`.  |

---

## MongoDB collections (database: `tokenDine`)

`users` · `clients` · `products` · `tokenSales` · `clientPurchases` · `attendance` · `complaints` · `bonuses` · `tableAssignments` · `dailyProgress` · `auditLogs`

---

## Quick examples

```bash
# Admin login
curl -X POST https://tokendinerestaurent.vercel.app/auth/login/admin \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@restaurant.com","password":"12345"}'

# Dashboard overview
curl https://tokendinerestaurent.vercel.app/analytics/overview

# List low-stock products
curl "https://tokendinerestaurent.vercel.app/products?status=low-stock"

# Seed the database (dev only — destructive)
curl -X POST https://tokendinerestaurent.vercel.app/seed
```
