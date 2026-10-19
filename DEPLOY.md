# Put ReCompute on the web

One machine serves the studio and the API. That is the setup that stays under $5 a month, including a `.com`.

Prices below are Fly.io's published Ashburn (`iad`) rates and Cloudflare Registrar's at-cost `.com` price, checked 19 October 2026. Fly bills a 31-day month a little higher than the 30-day figure.

| What | Price |
|---|---|
| `shared-cpu-1x`, 512 MB, always on | $3.69 per 30 days |
| 1 GB volume for the SQLite database | $0.15 per month |
| Shared IPv4 and IPv6 | $0 |
| First 10 single-hostname certificates | $0 |
| Outbound traffic in North America | $0.02 per GB |
| `.com` at Cloudflare Registrar | $10.46 per year, about $0.87 per month |

**About $4.71 per month** with a new `.com`. About **$3.84 per month** if you already own the domain.

A 1 GB machine is $6.70 and breaks the cap on its own. Managed Postgres starts at $38. A dedicated IPv4 is an extra $2. Leave all three off.

## What has to be yours

This repo is ready to deploy. Creating the Fly account, adding a card, and choosing the domain happen in your accounts.

New Fly organizations get a trial of 2 hours of machine runtime or 7 days, whichever comes first. After that, Fly requires a card. There is no ongoing free tier.

Anyone with the link can view the fleet and record moves. There is no sign-in. The sample fleet is synthetic. Set `DEMO_RESET_TOKEN` so a stranger cannot wipe it.

## 1. Install flyctl and sign in

```bash
curl -L https://fly.io/install.sh | sh
fly auth signup
```

Use `fly auth login` if you already have an account.

## 2. Name the app

Fly app names are global. `recompute-studio` in `fly.toml` may already be taken. If `fly apps create` says so, edit the `app` line and use that name in every command below.

```bash
fly apps create recompute-studio
```

## 3. Disk, then secret, then deploy

Create the volume before the first deploy. The name `recompute_data` has to match `fly.toml`. The database file is `/data/recompute.db`. Without the volume, uploads disappear when the machine restarts.

```bash
fly volumes create recompute_data --size 1 --region iad --yes
fly secrets set DEMO_RESET_TOKEN="$(openssl rand -hex 24)"
fly deploy
```

`fly deploy` builds the Dockerfile: the Vite app with `VITE_API_BASE=/api`, then FastAPI, which serves both. The first boot loads the sample fleet into the empty database.

Leave the machine count at 1. SQLite on this volume has one writer.

```bash
fly status
fly open
```

`fly open` uses `https://recompute-studio.fly.dev` (or whatever you named the app). The first deploy also receives a free shared IPv4 and an IPv6 address. Check them with `fly ips list`. The v4 row should say `shared`.

Do not run `fly ips allocate-v4` on its own. That command allocates a dedicated address at $2 per month. If a shared address is missing, allocate only the free one:

```bash
fly ips allocate-v4 --shared
```

## 4. Your domain

Buy the name at [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) or use one you already have. On 19 October 2026 a `.com` there is $10.46 for the year, renewal included at the same price. Verisign raises the wholesale `.com` fee on 1 November 2026, so a name registered before then keeps the current rate for its first year.

Add the hostnames. The first ten single-hostname certificates are free. Skip wildcards.

```bash
fly certs add example.com
fly certs add www.example.com
```

`fly certs add` prints the records to create. For the apex, use the A and AAAA addresses it shows (the same ones as `fly ips list`). For `www`, use the CNAME target it shows.

At Cloudflare, create those records with the proxy off (grey cloud) until `fly certs check example.com` says the certificate is ready. An orange-cloud proxy blocks the usual certificate check. If you turn the proxy on later, set SSL to Full and add the `_fly-ownership` TXT record that `fly certs setup example.com` prints.

```bash
fly certs check example.com
fly certs check www.example.com
```

Open `https://example.com`. You should get the studio, and `https://example.com/api/health` should return `{"ok": true, ...}`.

## Keep the bill in this shape

- One machine, `shared-cpu-1x`, 512 MB, region `iad`.
- One 1 GB volume.
- Shared IPv4 only.
- No Postgres, no extra machines, no static egress IP.
- `auto_stop_machines` stays `off`, so the site does not sleep. Stopping it would cut compute, and the volume would still cost $0.15.

Watch the upcoming invoice in the Fly dashboard after the first day.

## Local check of the same process

```bash
cd frontend && VITE_API_BASE=/api npm run build
cd ../backend
SERVE_WEB=1 WEB_DIST=../frontend/dist-build SEED_ON_START=true \
  .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8766
```

Open http://127.0.0.1:8766.

## Take it down

```bash
fly apps destroy recompute-studio
```

Destroying the app removes the machine. Confirm the volume is gone in the dashboard so it does not keep billing at $0.15.
