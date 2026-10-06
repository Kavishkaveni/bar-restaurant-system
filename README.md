# Bar & Restaurant System

One responsive website that runs a single-outlet bar, restaurant and rooms
business: billing, liquor and food stock, rooms, purchasing, expenses, reports
and AI. Staff use it on a counter PC or tablet; the owner uses it on a phone.

Phases 1 and 2 of 8 are done: the foundation (login, staff, roles, settings,
audit log, layout) and inventory and purchasing.

## What works now

### Inventory and purchases (phase 2)

- **Categories** grouped into Bar, Sundries, Kitchen and Other.
- **Items** counted the way they're really handled: bottles measured in ml,
  packs of pieces (cigarettes sold by pack or single), single pieces, kilograms
  or litres. Cost price, selling price, reorder level, usual supplier, barcode.
  Items you don't count (salt, spices) can be bought and costed without stock.
- **Stock ledger**: stock is never overwritten. Every change is a row in
  `stock_movements` in the smallest unit (ml, g, piece), and stock on hand is
  their sum. Shown as staff count it: "5 bottles + 600 ml", "3 packs + 7 pcs".
- **Opening stock** once per item, **wastage** with a reason, and **stock
  counts** that record the difference instead of overwriting.
- **Stock history** per item with a running balance, who did it, and when.
- **Low-stock** filter and warnings based on each item's reorder level.
- **Average cost**: purchases update each item's weighted average cost, which
  values the stock and will be used for profit in later phases.
- **Suppliers** with how much you owe each one.
- **Purchases**: enter a supplier invoice with any number of lines; stock goes up
  in the same transaction. Record payments later. Cancel a purchase entered by
  mistake and its stock is taken back out (unpaid purchases only).
- An item's unit can't change once stock is recorded, because past stock was
  counted in the old unit.

### Foundation (phase 1)

- **Login with a password**, or **switch staff with a 4-digit PIN** on a shared
  counter screen (tap your name, enter your PIN). Five wrong PINs lock that
  PIN for 5 minutes; password login still works.
- **Staff**: add, edit, set or remove a PIN, deactivate and reactivate. Staff are
  never deleted, so old bills and audit entries keep their names.
- **Roles**: Owner, Manager, Receptionist, Bartender, Waiter, Kitchen. Tick what
  each role can do; changes apply straight away without logging out. The Owner
  role always has everything, and the last active owner can't be removed.
- **Settings**: business name, address, phone, currency, tax, service charge,
  receipt message.
- **Audit log**: every login and change, who made it, what changed. Passwords and
  PINs are never stored in it.
- **My account**: change your own password (logs out your other devices).
- **Menu by role**: each person only sees the pages their role allows. Pages for
  later phases show when they arrive.
- **Phone and laptop layouts**: sidebar on wide screens, top bar and slide-in menu
  on phones.

## Run it

Needs [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
cp .env.example .env        # then edit JWT_SECRET and OWNER_PASSWORD
docker compose up --build
```

- Website: http://localhost:3000
- API docs (try every endpoint): http://localhost:8000/docs
- First login: the `OWNER_USERNAME` / `OWNER_PASSWORD` from `.env`
  (default `owner` / `ChangeMe123!`). Change the password from **My account**.

On start, the API applies database migrations and creates the default roles,
settings and owner account if they're missing. It is safe to restart.

### Without Docker

```bash
# Backend (needs PostgreSQL 16 running, with databases barpos and barpos_test)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL=postgresql+asyncpg://barpos:barpos@localhost:5432/barpos
alembic upgrade head && python -m app.seed
uvicorn app.main:app --reload

# Website (another terminal)
cd frontend
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
npm install && npm run dev
```

## Tests

```bash
docker compose exec api pytest        # with Docker
cd backend && pytest                  # without Docker
```

50 tests cover login, PIN lockout, token refresh, password change, permission
checks, the last-owner rule, settings, the audit log, items, purchases, average
cost, cancelling purchases, opening stock, wastage and counts. Tests only ever run
against a database whose name ends in `_test` and refuse to start otherwise,
because they drop and recreate every table.

## Project layout

```
backend/
  app/
    api/          auth, users, roles, settings, audit_log routes; deps.py has
                  get_current_user and require("permission")
    core/         config, password/JWT helpers, permission catalogue + default roles
    models/       SQLAlchemy models
    schemas/      request/response models
    services/     audit.record() — call it in every change
    seed.py       default roles, settings, first owner
  migrations/     Alembic
  tests/
frontend/
  src/
    app/login/    password login and PIN pad
    app/(app)/    pages behind login: home, users, roles, settings, audit, account,
                  and [module] placeholders for later phases
    components/   AppShell (sidebar/menu), Guard (permission gate), ui.tsx
    lib/          api.ts (fetch + token refresh), auth.tsx, nav.ts (menu + permissions)
docker-compose.yml
```

## How to add a feature in later phases

1. **Permission**: add it to `PERMISSIONS` in `backend/app/core/permissions.py`
   and to the right roles in `DEFAULT_ROLES` (new installs). For an existing
   database, tick it for each role on the Roles page.
2. **Backend route**: protect it with `Depends(require("your.permission"))` and
   call `audit.record(...)` before `db.commit()` for anything that changes data.
3. **Migration**: `alembic revision --autogenerate -m "what changed"`, check the
   file, then `alembic upgrade head`.
4. **Page**: add `src/app/(app)/<name>/page.tsx` wrapped in `<Guard anyOf={[...]}>`,
   and remove `phase` from its entry in `src/lib/nav.ts`.

## Security notes

- Passwords and PINs are hashed with bcrypt.
- Access tokens last 30 minutes and refresh automatically. Password sessions
  last 7 days; PIN sessions last 16 hours (one shift).
- Deactivating someone or changing their password logs them out everywhere.
- In production set `APP_ENV=production`; the API refuses to start with a
  `JWT_SECRET` shorter than 32 characters.

## Build plan

| Phase | What | Status |
| --- | --- | --- |
| 1 | Foundation: login, roles, staff, settings, audit log, layout | Done |
| 2 | Items, suppliers, purchases, stock ledger | Done |
| 3 | POS and billing (go live for bar and sundries) | Next |
| 4 | Bar pegs, open bottles, recipes, kitchen screen | |
| 5 | Rooms, bookings, room bills, housekeeping | |
| 6 | Expenses, shifts, reports | |
| 7 | Admin dashboard with live charts | |
| 8 | AI features, backups, deployment | |
