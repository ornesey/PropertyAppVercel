# SupaPM

Simple Supabase test app using Next.js.

## Local development

1. Add environment variables in `.env.local` at the project root.

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
# or use NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY instead of NEXT_PUBLIC_SUPABASE_ANON_KEY.
```

2. Install dependencies:

```bash
npm install
```

3. Run the development server:

```bash
npm run dev
```

4. Open the local page in your browser at the port shown by Next.js (for example `http://localhost:3002`).

## Vercel deployment

Vercel does not use `.env.local`. Add these variables to the Vercel project Environment Variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Then redeploy the project.

## Notes

- Do not commit `.env.local` to GitHub.
- If you changed the repo to public, Vercel should now allow deploys from the same account.
- This app currently reads from `rental.users` and expects a `user_id` column.
