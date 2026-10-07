# Deploy this WeBake project

This guide follows the services and configuration already in this repository:

- Supabase provides PostgreSQL and file storage.
- Render runs the Express API from `backend/` using the root `render.yaml` Blueprint.
- Vercel hosts the static site from `frontend/` and forwards `/api/*` to Render.
- Brevo sends OTP and order emails through its HTTPS API.

The deployment order is Supabase, Brevo, Render, seed the database, Vercel, then connect the Vercel URL back to Render. You will need accounts for these services and access to the GitHub repository containing this project. This guide prepares and connects the services; it does not deploy them for you.

## 1. Prepare the project repository

Render and Vercel deploy from GitHub. The repository root must contain:

```text
render.yaml
backend/
frontend/
docs/
```

If this project is not in GitHub yet, create a repository and push the project folder with that structure. Do not put credentials in GitHub. The local backend environment file is `backend/.env`; use `backend/.env.example` as a reference and keep real credentials out of commits.

## 2. Create the Supabase project

1. Create a Supabase project. The repository's deployment notes specify the Singapore region (`ap-southeast-1`) to match the Render service region.
2. Set and save the database password during project creation. Keep it available for the connection string.
3. Click **Connect** in the Supabase dashboard, choose the PostgreSQL **Session pooler**, and copy the complete connection string. The shared Session pooler uses port `5432`; use the host and `postgres.PROJECT_REF` username from the copied string. It should look like:

   ```text
   postgresql://postgres.PROJECT_REF:PASSWORD@POOLER-HOST:5432/postgres
   ```

   Use the actual values Supabase displays; do not use this example literally. This full value becomes Render's `DATABASE_URL`.
4. Open **Project Settings → API** and copy the **Project URL** and the **service_role** key. These become `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on Render. Keep the service role key private; it must never be put in Vercel or frontend JavaScript.
5. Open **Storage** and create these two buckets:

   | Bucket | Access | Used for |
   | --- | --- | --- |
   | `payment-proofs` | Private | Customer payment screenshots |
   | `product-images` | Public | Product images |

6. Do not create the application tables manually. The Render build runs this project's versioned SQL migrations.

## 3. Prepare Brevo for email

The project uses Brevo for registration and checkout verification codes, password reset, and email receipts. Without `BREVO_API_KEY`, the API can start, but OTP requests are disabled, so customer registration and checkout cannot complete.

1. Create a Brevo account.
2. In **Settings → Senders**, add `crbwebake@gmail.com` and complete the sender verification email.
3. In **SMTP & API → API Keys**, create and copy an API key. It becomes Render's `BREVO_API_KEY`.

## 4. Deploy the Render API from the Blueprint

1. Sign in to Render and connect the GitHub account that can access this repository.
2. Choose **New → Blueprint**, select the repository, and let Render read the root `render.yaml`.
3. Confirm the preview shows the `webake-api` Node web service with `backend` as its root directory. The Blueprint already sets the build command to `npm install && npm run migrate`, the start command to `node server.js`, and the health check to `/health`.
4. Fill in the requested values:

   | Render variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Full Supabase pooler string from step 2, including the actual database password |
   | `FRONTEND_URL` | Temporary value `https://placeholder.local`; replace this after Vercel is deployed |
   | `ADMIN_PASSWORD` | A strong, unique password for the owner account that you will use when seeding |
   | `BREVO_API_KEY` | Brevo API key |
   | `SUPABASE_URL` | Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |

   Render generates `JWT_SECRET` from the Blueprint. Other values such as `NODE_ENV`, the sender address, and the business defaults are already specified in `render.yaml`. Render supplies `PORT` automatically; do not add your own `PORT` variable there.
5. Apply the Blueprint and deploy. Open the service's **Logs** and wait for the build to finish. It should report six migrations applied on the first run, followed by a successful server start and health check.
6. Copy the service's public URL, for example `https://webake-api-xxxx.onrender.com`. This is the API URL used in the next steps.

If the build fails during migrations, check `DATABASE_URL` first: it must be a PostgreSQL connection string beginning with `postgresql://`, from Supabase's Session pooler, with the right database password and no extra spaces. Percent-encode reserved characters in the password (such as `@`, `#`, `?`, `&`, or spaces) if you insert it manually.

## 5. Check the API before deploying the frontend

Open these addresses in a browser, replacing `<render-url>` with the Render service URL:

1. `https://<render-url>/health` should return JSON with `"status":"healthy"` and a connected database.
2. `https://<render-url>/api/products` should return a successful response. Before seeding, the products list will be empty; after seeding, it should contain eight products.
3. `https://<render-url>/api/settings/public` should return public settings.

If the health response says `degraded` or `connected:false`, the API is running but cannot connect to the database. Fix the database URL or password in Render and redeploy before continuing.

## 6. Run migrations and seed from your computer

You do not need Render's paid Shell for this step. The project's npm scripts can connect directly to the same Supabase database from your computer. Render still runs migrations during its build; this local path is also useful for bootstrapping the first database.

1. On your computer, open PowerShell in the repository's `backend` folder:

   ```powershell
   cd C:\Users\rodny\OneDrive\Documents\Desktop\webake\backend
   ```

2. If `backend/.env` does not exist yet, create it from the example. This command leaves an existing `.env` untouched:

   ```powershell
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }
   ```

3. Open `backend/.env` and set these values using your **rotated** credentials:

   - `DATABASE_URL`: the full PostgreSQL Session pooler string from Supabase Connect, with the new database password. URL-encode reserved password characters.
   - `JWT_SECRET`: a random secret at least 32 characters long.
   - `ADMIN_EMAIL`: `crbwebake@gmail.com` or the owner email you want to use.
   - `ADMIN_PASSWORD`: a new owner password. Use the same one set in Render if you want the Render seed configuration to match.

   Keep `SUPABASE_URL` as the `https://…supabase.co` project URL. `SUPABASE_SERVICE_ROLE_KEY` and `BREVO_API_KEY` are not needed for migration or seeding. `.gitignore` excludes `backend/.env`; never commit it or paste it into chat.
4. Install the backend dependencies and run the scripts from the `backend` folder:

   ```powershell
   npm install
   npm run migrate
   npm run seed
   ```

5. Confirm the output says the migrations were applied and the seed created the admin, eight products, sample reviews, and default settings.

The seed script is idempotent: running it again does not overwrite the stored admin password, product stock, or edited settings. If the admin was already seeded with a different password, changing `ADMIN_PASSWORD` does not change the existing account; use the account's reset flow. Seeded product stock starts at zero, so restock products in Admin → Inventory before checkout can succeed.

## 7. Point Vercel's API rewrite at Render

The existing `frontend/vercel.json` contains a placeholder host. Replace it with the Render URL from step 4 before the final Vercel deployment.

1. Open `frontend/vercel.json` and change only the rewrite destination host:

   ```json
   "destination": "https://YOUR-RENDER-SERVICE.onrender.com/api/:path*"
   ```

   For example, if Render gave you `https://webake-api-1234.onrender.com`, use:

   ```json
   "destination": "https://webake-api-1234.onrender.com/api/:path*"
   ```

   Keep `/api/:path*` at the end. Do not add a trailing slash after the Render hostname. Commit and push this change to GitHub.
2. In Vercel, choose **Add New → Project** and import the same GitHub repository.
3. Set **Root Directory** to `frontend` and confirm Vercel recognizes `frontend/vercel.json`.
4. Use the **Other** framework preset. This project is static HTML/CSS/JavaScript: leave the build command and output directory empty, then deploy.
5. Note the Vercel production URL, such as `https://webake-xxxx.vercel.app`.

The customer storefront URL is `https://<vercel-url>/customer/html/home.html`. The admin sign-in URL is `https://<vercel-url>/admin/html/login.html`.

In production, the frontend calls the same-origin `/api` path. Vercel's rewrite forwards those requests to Render. The browser should not be configured with the Supabase credentials or Render secrets.

## 8. Set Render's production CORS URL

1. Return to Render → `webake-api` → **Environment**.
2. Replace `FRONTEND_URL` with the exact Vercel production origin, for example `https://webake-xxxx.vercel.app`. Do not add a path or trailing slash.
3. Save the change and wait for Render to redeploy.

The API uses this exact origin in its CORS allowlist. If you later add a Vercel custom domain, update `FRONTEND_URL` to that exact domain too.

## 9. Verify the deployed customer and admin flows

1. Open the customer storefront URL and then the Products page. It should load the eight seeded products through `/api/products`.
2. Open the admin sign-in URL and sign in with `crbwebake@gmail.com` and the password used for seeding.
3. In **Settings**, replace the placeholder payment account details and QR images with the bakery's real information.
4. In **Inventory**, restock products with actual stock counts. The seed initializes stock at zero; checkout cannot pass its stock check until stock is added.
5. For an end-to-end customer checkout, verify Brevo sends the OTP and confirm the submitted payment appears in the admin Orders area.

## 10. What to check when a page cannot load products

- **`/health` is unhealthy:** check Render logs and `DATABASE_URL`.
- **`/api/products` fails on the Render URL:** the issue is between Render and Supabase; check the database connection and migration logs.
- **Render `/api/products` works but the Vercel site fails:** confirm `frontend/vercel.json` contains the correct Render host, redeploy Vercel, and confirm Render's `FRONTEND_URL` exactly matches the Vercel domain.
- **The API is slow on its first request:** the Blueprint uses Render's free plan; an idle service may need time to wake up.
- **OTP/email actions fail:** confirm the Brevo API key and verified sender address.
- **Payment screenshot upload fails:** confirm both Supabase Storage settings are on Render and that the `payment-proofs` private bucket exists.

## Keep these values private

Never commit `backend/.env`, the Supabase database password, the Supabase `service_role` key, the Brevo key, or the Render-generated `JWT_SECRET`. These belong in Render's environment settings. Only the public Render hostname belongs in `frontend/vercel.json`.
