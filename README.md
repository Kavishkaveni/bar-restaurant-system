# Bar & Restaurant System

One responsive website that runs a single-outlet bar, restaurant and rooms
business: billing, liquor and food stock, rooms, purchasing, expenses, reports
and AI. Staff use it on a counter PC or tablet; the owner uses it on a phone.

Phases 1 to 6 of 8 are done: the foundation (login, staff, roles, settings,
audit log, layout), inventory and purchasing, the POS, the bar and kitchen
side (pegs from open bottles, recipes, kitchen screen), rooms, and expenses,
the cash drawer and reports.

## What works now

### Expenses, cash drawer and reports (phase 6)

- **Expenses** by category (salaries, rent, electricity, licences, repairs…;
  categories can be added or renamed), with date, amount, how it was paid and
  who to. Mistakes are cancelled with a reason, not deleted.
- **Cash drawer**: a cashier opens a shift with a float. Cash from bills and
  room payments goes in, voided cash bills, pay-outs (expenses paid from the
  till) and cash drops come out. At close the cashier counts notes and coins
  and the system shows short or over. Past shifts are listed for the owner.
- The POS shows whether the drawer is open and how much should be in it.
- **Reports** for today, yesterday, a week, a month or any dates: sales by
  section, room income, cost of what was sold, wastage, stock count
  differences, expenses and profit; money in by method; best sellers; day by
  day. Managers see sales; profit needs "Dashboard: profit and costs".
- **Stock movement** report: start, received, sold, wasted, count differences
  and end for every item, with stock value; download for Excel.

### Rooms (phase 5)

- **Rooms and prices**: room types (Standard AC, Deluxe…) each with a price per
  night and an optional short-stay price (e.g. 3 hours, then per extra hour).
- **Room board**: every room at a glance: free, occupied, arriving today, or
  past check-out time, plus housekeeping (clean, needs cleaning, maintenance).
- **Bookings and walk-ins**: only free rooms can be chosen for the dates; an
  advance can be taken when booking. Check-in records name, phone, NIC or
  passport, guests, address and vehicle number.
- **Room bill**: room charge, extras (laundry, extra bed), discounts (manager),
  room tax (Settings), room service, payments. Change dates, extend, or move
  the guest to another room.
- **Room service**: "Room service" on the POS opens an order for a staying
  guest; "Charge to room" moves any bill to the guest's room bill. Stock goes
  out at once; the guest pays at check-out. Voiding the bill takes it off.
- **Check-out**: nights are counted by date (hours for a short stay); charging
  fewer needs a manager. Takes the balance or gives back extra advance, prints
  the room bill, and marks the room for cleaning.
- **Cancel / no-show**: the advance is refunded or kept as a cancellation charge.
- Receptionists see only room service on the POS.

### Bar pegs, recipes and kitchen (phase 4)

- **Pegs**: on a bottle item, add a selling option smaller than the bottle
  (quick-fill buttons for 30, 60 and 100 ml). Each peg pours from the oldest
  open bottle; when it runs out, the next sealed bottle opens by itself and the
  pour carries over. Voiding a bill puts the ml back.
- **Open bottles** (Inventory tab): ml left in each open bottle, sealed count,
  a warning when almost out. "Empty" closes a bottle and records anything the
  system still shows in it as wastage, so over-pouring becomes visible.
- **Dishes and recipes**: add an item as "Dish made to order" with a menu
  price, then its recipe per plate with as many ingredients as needed (grams,
  ml or pieces). Shows ingredient cost, cost with kitchen overhead (Settings),
  profit per plate and how many plates the stock allows. Selling a dish takes
  the ingredients from stock when the bill is paid.
- **Batch items** like a Spice Mix: a stocked item with a batch recipe; "Make a
  batch" takes the ingredients and adds the batch to stock at its real cost.
- **Kitchen screen**: food on any bill appears within 5 seconds, grouped by
  table, with a chime for new orders and a waiting timer. Cooks tap Start,
  Ready and Served; the bill on the POS shows the same status. Removing food
  the kitchen has started needs a manager's PIN.

### POS and billing (phase 3)

- **Floor screen**: tables grouped by area, free or occupied with the running
  total and how long it's been open. Plus quick **Bar sale**, named **Tabs**
  that stay open across rounds, and **Takeaway**.
- **Order screen** built for touch: category chips, big item buttons, search.
  Items sold more than one way (a pack or a single cigarette) ask which.
- **Selling options** per item (Inventory, open an item, "How it's sold"):
  e.g. "Single" takes 1 stick from a pack of 20.
- **Bill**: quantities, discount (percent or amount, with a reason), service
  charge and tax from Settings. Rates are copied when the bill opens.
- **Split** items to a new bill, **merge** two bills, **move** to another table,
  customer name and notes.
- **Payment**: cash (with change and quick note buttons), card, bank transfer,
  QR, several payments on one bill, split equally, tips kept separate.
- **Stock is deducted when the bill is fully paid**, at the item's average cost,
  so profit can be reported later. **Voiding a paid bill puts the stock back.**
- **Manager approval with PIN**: discounts, voids, removing service charge, and
  taking items off a bill after it was printed or part-paid. A manager picks
  their name and enters their PIN on the same screen. Every approval is in the
  audit log with who asked and who approved.
- **80 mm receipts** from the browser: BILL before payment, RECEIPT after,
  reprints marked COPY.
- **Today's bills**: sales total, bills, totals by payment method, tips, voids,
  any past day.

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

110 tests cover login, PIN lockout, token refresh, password change, permission
checks, the last-owner rule, settings, the audit log, items, purchases, average
cost, cancelling purchases, opening stock, wastage, counts, bill totals,
payments, stock deduction, voids, manager approvals, split and merge. Tests only ever run
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
| 3 | POS and billing (go live for bar and sundries) | Done |
| 4 | Bar pegs, open bottles, recipes, kitchen screen | Done |
| 5 | Rooms, bookings, room bills, housekeeping | Done |
| 6 | Expenses, shifts, reports | Done |
| 7 | Admin dashboard with live charts | Next |
| 8 | AI features, backups, deployment | |
