# Putting the system online

This puts the whole system on a cloud server with your domain and free HTTPS,
so staff can use it from phones and tablets anywhere, and the owner can check
the dashboard from home.

You need:

- A **cloud server (VPS)** running **Ubuntu 24.04** with at least **2 GB RAM**
  (DigitalOcean, Hetzner, Vultr, Linode, or a Sri Lankan provider). About
  USD 6–12 a month.
- Your **domain**, for example `pos.mybar.lk` (a subdomain is fine).
- The project on **GitHub** (you push it there already).

Everything below is typed in a terminal. On Windows use **PowerShell**.

---

## 1. Create the server

1. At your provider, create a server: **Ubuntu 24.04**, **2 GB RAM** or more,
   in a nearby region (Singapore or Mumbai for Sri Lanka).
2. Choose **password** login (simplest) and note the **IP address** it shows,
   for example `203.0.113.25`.

## 2. Point the domain at the server

At the company where you bought the domain, open its **DNS** settings and add:

| Type | Name | Value |
|------|------|-------|
| A | `pos` (or `@` for the main domain) | your server IP |

It can take from a few minutes up to an hour to work. Check with
`ping pos.mybar.lk`: it should show your server IP.

## 3. Log in to the server

```powershell
ssh root@203.0.113.25
```

Type `yes` the first time, then the password.

## 4. Prepare the server (once)

Copy and paste these one block at a time:

```bash
# Updates
apt update && apt upgrade -y

# Docker
curl -fsSL https://get.docker.com | sh

# Firewall: only SSH and the website
ufw allow OpenSSH && ufw allow 80 && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable

# Extra memory for building (helps on 2 GB servers)
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 5. Get the code

If the GitHub repository is **private**, make a token first: GitHub →
Settings → Developer settings → Personal access tokens → **Fine-grained
token** → only this repository, **Contents: Read-only**. Copy it.

```bash
cd /opt
git clone https://github.com/YOUR-NAME/bar-restaurant-system.git
cd bar-restaurant-system
```

(For a private repository, use the token as the password when asked.)

## 6. Fill in the settings

```bash
cp .env.prod.example .env.prod
openssl rand -base64 36   # run this twice: one for POSTGRES_PASSWORD, one for JWT_SECRET
nano .env.prod
```

Fill in `DOMAIN`, `POSTGRES_PASSWORD`, `JWT_SECRET` and `OWNER_PASSWORD`.
Save with **Ctrl + O**, **Enter**, then exit with **Ctrl + X**.

Keep a copy of this file somewhere safe (not on GitHub). **Without
`POSTGRES_PASSWORD` you can't open the database.**

## 7. Start it

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

The first time takes 5–10 minutes. Check that everything is running:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

All four (`db`, `api`, `web`, `caddy`) should say **running** (or **healthy**).

Open **https://pos.mybar.lk** in a browser. Log in as `owner` with the
`OWNER_PASSWORD` you set, then:

1. **My account** → change the password.
2. **Settings** → business name, address, phone, tax and service charge.
3. **Settings → AI assistant** → paste a free key (see below).
4. **Staff** → add your staff with their roles and PINs.

## 8. Phones and tablets

Open the address on the phone, log in, then:

- **Android (Chrome):** ⋮ menu → **Add to Home screen** → **Install**.
- **iPhone (Safari):** Share button → **Add to Home Screen**.

It opens full screen like an app.

---

## AI assistant key (free)

**Google Gemini** (free tier):

1. Go to https://aistudio.google.com/apikey and sign in with a Google account.
2. **Create API key** → copy it.
3. In the system: **Settings → AI assistant** → service **Google Gemini** →
   paste the key → **Save** → **Test it**.

**Groq** (free plan) works the same way with a key from https://console.groq.com/keys.

On free plans the AI company may use what is sent to improve its products.
The assistant only sends business figures (sales, item names, stock, room
counts), never guest names, phone numbers or ID numbers.

---

## Updating to a new version

```bash
cd /opt/bar-restaurant-system
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Database changes are applied automatically when the API starts.

## Backups

- Every day after **03:00** a full copy of the database is made, and the newest
  **14** are kept on the server.
- **Settings → Backups** → **Back up now** and **Download**. Download one
  every week or so and keep it on Google Drive or a USB drive. A backup on
  the same server doesn't help if the server itself is lost.

### Restoring a backup

This **replaces all data** with the backup's. Only do it if the data is lost
or broken.

```bash
cd /opt/bar-restaurant-system
# Copy the backup file to the server first if it's on your computer:
#   scp barpos-20261006-0300.dump root@203.0.113.25:/opt/bar-restaurant-system/
docker compose -f docker-compose.prod.yml --env-file .env.prod stop api
docker compose -f docker-compose.prod.yml --env-file .env.prod cp barpos-20261006-0300.dump db:/tmp/restore.dump
docker compose -f docker-compose.prod.yml --env-file .env.prod exec db \
  pg_restore --clean --if-exists --no-owner -U barpos -d barpos /tmp/restore.dump
docker compose -f docker-compose.prod.yml --env-file .env.prod start api
```

## When something is wrong

```bash
cd /opt/bar-restaurant-system
docker compose -f docker-compose.prod.yml --env-file .env.prod ps            # what's running
docker compose -f docker-compose.prod.yml --env-file .env.prod logs api --tail 100
docker compose -f docker-compose.prod.yml --env-file .env.prod logs caddy --tail 50
docker compose -f docker-compose.prod.yml --env-file .env.prod restart        # restart everything
```

- **Browser says the site can't be reached / certificate error:** the domain's
  DNS doesn't point to the server yet, or ports 80/443 are blocked. Check step 2
  and the firewall; then `restart caddy`.
- **"Cannot reach the server" inside the app:** look at `logs api`.
- The server restarts the system by itself after a reboot.
