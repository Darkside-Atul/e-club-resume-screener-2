# E-Club Resume Screener

The internal Ashoka University Entrepreneurship Club resume screener. Authorized reviewers create projects, import a roster CSV with individual PDFs or a ZIP archive, review evidence, record decisions, and export a shortlist. Applicant records are stored without creating student login accounts. The app uses Next.js App Router, Auth.js with direct Google OAuth, Supabase Postgres/private Storage, PDF.js, Zod, and the official Google Gen AI SDK.

## Run locally

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Use Node 22 or 24. For real local Auth, Postgres and Storage, use Supabase CLI v3 with a running Docker-compatible engine and run `npx supabase start` from this directory. The CLI applies the migrations and prints the API URL and keys for `.env.local`. Use the local mail inbox at `http://localhost:54324` to confirm a new account. Use a synthetic account at the configured domain. A separate hosted Supabase project also works for development.

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Tests run the production migrations on PostgreSQL via PGlite, parse synthetic PDFs with PDF.js, and mock model and service responses at test boundaries. They do not require hosted services.

## Read-only web demo

Set `DEMO_MODE=true` in the hosting environment for a public demonstration without Supabase credentials. The app serves synthetic project and reviewer examples, and server-side backend access is disabled. Leave `DEMO_MODE` unset or false for the connected MVP.

## Configure Supabase data and Google sign-in

1. Create a Supabase Free project. From this checkout, run `npx supabase login`, `npx supabase link --project-ref YOUR_PROJECT_REF` and `npx supabase db push --remote --dry-run`. Review the pending migrations, then run `npx supabase db push --remote` for the linked project. The migrations create the private `resumes` bucket, RLS policies, transactional jobs, rate limiter, reviewer records, and shortlist queries.
2. Configure direct Google OAuth for Auth.js. Create a Web OAuth client and add the exact redirect URI `https://YOUR_APP_HOST/api/auth/callback/google`; for local development add `http://localhost:3000/api/auth/callback/google`. Google redirect URIs must match exactly; register any preview host you plan to use. Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and a unique `AUTH_SECRET` in the host environment. The app only accepts Google-verified emails in `AUTHORIZED_EMAIL_DOMAIN` and never grants roles from Google metadata.
3. There is no separate public registration form. On first sign-in, Auth.js accepts a Google-verified `@ashoka.edu.in` address and automatically creates or promotes its `public.profiles` row as a reviewer. Google/user metadata never sets roles; the server validates the domain and assigns the fixed reviewer role. This grants reviewer access to every verified Google account in the configured domain. The default is `ashoka.edu.in`; if the university authorizes a different domain, update `AUTHORIZED_EMAIL_DOMAIN` and `private.settings.authorized_domain` together.

## Environment variables

| Variable | Configuration |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Connect / API Keys. Build with these available. |
| `SUPABASE_SECRET_KEY` | Secret or legacy service-role key. Set only on the server. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET` | Direct Google OAuth credentials and Auth.js session encryption secret. Configure the Google callback as `<app-origin>/api/auth/callback/google`. |
| `AUTHORIZED_EMAIL_DOMAIN` | Campus domain allowed for verified Google accounts; keep it aligned with the database’s `private.settings` domain. |
| `MAX_RESUME_MB` | Default 10, range 1–25. Configure `resumes` bucket and project Storage limits to the same byte limit when changing it. |
| `APPLICATION_RETENTION_DAYS` | Default 180, range 1–3,650, measured from the project deadline. Set the club’s approved retention period before launch. |
| `CRON_SECRET` | Worker bearer secret. Generate using `openssl rand -hex 32`. |
| `AI_SCREENING_MODE`, `AI_PROVIDER`, `AI_MODEL` | `off`, `synthetic`, or `private`; `gemini` or `ollama`; structured-output-capable model. |
| `GEMINI_SYNTHETIC_API_KEY`, `AI_SYNTHETIC_PROJECT_ID`, `AI_SYNTHETIC_PDF_SHA256` | Development-only Gemini key, one questionless test project UUID and comma-separated hash allowlist. |
| `AI_PRIVATE_DATA_APPROVED`, `GEMINI_API_KEY` | Explicit private-processing approval and a dedicated Gemini key. `GEMINI_PRIVATE_API_KEY` is retained as a legacy alias. |
| `OLLAMA_URL`, `OLLAMA_BEARER_TOKEN` | Local loopback or private HTTPS gateway, with optional server-only gateway bearer token. |
| `AI_REQUESTS_PER_MINUTE`, `AI_REQUESTS_PER_DAY` | Default 2/min and 20/day. Set at or below actual project quotas and consider token limits. |

## Choose a screening mode

- **Manual review (`off`, default).** Real submissions are accepted and can be reviewed and shortlisted. The worker marks jobs as Needs manual review without contacting any AI service.
- **Free Gemini development (`synthetic`, `gemini`).** The default model is `gemini-3.5-flash`. Create a separate billing-disabled AI Studio project and API key. Set the test project ID and allowlist only deliberately synthetic PDFs with no identifying information. The server checks the project and raw PDF SHA-256 and requires a questionless project before sending anything. Use a synthetic rubric and fictitious accounts. Never add a real resume hash to the list. Google may use unpaid-tier inputs and outputs for product improvement; free-tier processing is not enabled for imported real applicants. [Model pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Gemini data-use terms](https://ai.google.dev/gemini-api/terms)
- **Private Gemini (`private`, `gemini`).** Use a distinct key and project only after the university approves the processor, terms and retention. Set `AI_PRIVATE_DATA_APPROVED=true`, `GEMINI_API_KEY`, `AI_SCREENING_MODE=private`, and `AI_MODEL=gemini-3.5-flash`. The app extracts text and redacts detected identity and contact details before sending it; redaction is not anonymization, and PDFs are never sent to Gemini. Google’s paid API data terms prohibit product-improvement use of prompts and responses and include limited logging for security/legal purposes. Usage can incur charges. [Gemini data-use terms](https://ai.google.dev/gemini-api/terms)
- **Private local model (`private`, `ollama`).** Run a structured-output-capable model on already-provisioned campus hardware with cloud features disabled (`OLLAMA_NO_CLOUD=1`). Set `AI_MODEL` to a tested local model tag and enable private mode only after university approval. Keep Ollama on loopback if the app is self-hosted on the same server, or put it behind an authenticated TLS gateway for Vercel. Keep the endpoint private and use the gateway token. This can avoid a recurring API bill if the hardware and operating capacity already exist. Test the model’s accuracy and speed on synthetic resumes before enabling it for real applications. [Ollama structured outputs](https://ollama.com/blog/structured-outputs)

To generate a synthetic fixture and print its SHA-256, run this in the repo. Upload the generated `synthetic.pdf` to the designated test project. The fixture contains evidence for TypeScript, automated tests, and SQL reporting.

```sh
node --input-type=module -e 'import {fixturePdf} from "./tests/fixtures/pdf.ts"; import {writeFileSync} from "node:fs"; import {createHash} from "node:crypto"; const pdf=fixturePdf(); writeFileSync("synthetic.pdf",pdf); console.log(createHash("sha256").update(pdf).digest("hex"));'
```

Identity fields, contact identifiers detected in text, and portfolio URLs are withheld from model prompts. Redaction reduces exposure and does not establish anonymization of a real resume. The worker validates strict JSON and verifies supporting quotes against sanitized source text. Each criterion contributes 100%, 50% or 0% of its normalized weight for met, partial or unverified evidence. The final score is rounded once and bucketed at the saved thresholds. AI never records a decision. Reviewer decisions are versioned and audited separately.

## Deploy and run the worker

- **Vercel Hobby:** import the repository as a Next.js project. Set the environment variables, use Node 22/24, deploy, and register the canonical production callback `<production-origin>/api/auth/callback/google` with the Google OAuth client. Direct signed Storage uploads bypass Vercel’s 4.5 MB function-body limit. Native Vercel Cron is unnecessary. Vercel’s Hobby documentation limits the plan to non-commercial personal use. Get clarification from Vercel for an official university-operated project, sponsored or commercial activity, or any ambiguous use. Do not assume club status qualifies. [Vercel Hobby](https://vercel.com/docs/plans/hobby) · [Fair use](https://vercel.com/docs/limits/fair-use-guidelines)
- **Campus hosting alternative:** on an existing university server, build with `npm ci && npm run build` and run `npm start` under a service manager behind a campus-approved HTTPS reverse proxy. Use the same Supabase setup and scheduler. Supabase must be able to reach the worker endpoint, or schedule the worker with the campus host’s own cron using its local address. [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)

In Supabase, enable **Cron** (`pg_cron`) and **pg_net**. In **Vault**, add `screener_origin` (canonical origin, no trailing slash) and `screener_cron_secret` (exactly the app’s `CRON_SECRET`). Run [supabase/ops/schedule.sql](supabase/ops/schedule.sql) in SQL Editor. Cron checks for due jobs every minute and performs storage and retention cleanup every 15 minutes. For a local manual worker invocation, set `CRON_SECRET` in your terminal environment and use:

```sh
curl --fail-with-body -X POST -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/internal/screen
```

The queue takes one job per invocation, uses leases and submission versions, and retries a transient or invalid result once. HTTP 429 and exhausted budgets defer without consuming a job attempt. Gemini quotas vary by project, model, RPM, tokens/min and requests/day. The daily budget resets at midnight Pacific. The reviewer can manually retry failed jobs after resolving configuration or service issues. Scan-only PDFs use manual review. [Google quota dashboard guidance](https://ai.google.dev/gemini-api/docs/rate-limits) · [Supabase scheduling](https://supabase.com/docs/guides/cron)

## Production configuration and collaborators

Use [the production environment template](.env.production.example) to populate the host's Production environment. Use the hosted Supabase project and a fresh worker secret. Store the Supabase secret key, Google OAuth client secret, Auth.js secret, worker secret, and synthetic Gemini key as sensitive server-only values. Keep `.env.local` for the local Supabase stack and apply production values through the host. Add the canonical HTTPS callback `<production-origin>/api/auth/callback/google` to the Google OAuth client and verify sign-in with an approved campus reviewer account. [Vercel environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables)

In the personal GitHub repository, open **Settings → Collaborators → Add people** to invite teammates by GitHub username. Use branches and pull requests for code contributions. Keep deployment credentials and production Supabase access limited to maintainers who need them. [GitHub collaborator instructions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository)

Before deploying a change, run the checks above and review any new migrations with `supabase db push --remote --dry-run` against the verified hosted project. Apply pending migrations before deploying code that depends on them. For a Vercel Git integration, merge to the configured production branch and inspect the deployment status. Redeploy after changing Production environment values. Verify login, upload, processing and export against the canonical URL using the synthetic fixture. [Vercel Git integration](https://vercel.com/docs/git/vercel-for-github)

## Free-tier limits and launch check

Supabase Free currently includes 500 MB of database space, 1 GB of file storage, 5 GB of egress, and 50,000 monthly active users. It can pause after a week of inactivity and does not include automatic backups or point-in-time recovery. Resume uploads, validation reads, reviewer views, resubmissions and backup procedures consume quota. Vercel and Supabase can stop serving requests at free-tier limits, and a local model depends on existing compute and electricity. Verify terms and current quotas before committing to a pilot. [Supabase pricing](https://supabase.com/pricing) · [Vercel Function limits](https://vercel.com/docs/functions/limitations)

For a pilot, use two reviewer accounts and two students. Publish a project, test the 10 MB private upload and resubmission from a student account, run the worker, verify advisory evidence and signed resume expiry, record a decision and check its audit history. Confirm another reviewer and the other student cannot load confidential data. Verify export closes before deadline and includes only current shortlisted submissions after it. Check Google OAuth callback, verified-campus enforcement, sign-out, and responsive layouts on Android/iOS. Use a synthetic fixture for any free Gemini run. Establish a secure backup and restore process and protect CSV copies, which exist outside automated retention.

The scheduler purges resumes and application-linked records, including screening, scoring and decision history, after the configured period. Replaced and abandoned uploads are removed after their signed upload tokens expire. The project records and campus profiles remain available to the app. For an individual data removal handled by an administrator, delete the relevant application records through trusted administration and let the cleanup worker delete the corresponding Storage objects.
