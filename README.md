# Orqelio

Orqelio is a SaaS AI manager designed to work with a business's existing CRM
and messaging platforms. It is **not a CRM**: operational business data remains
owned by the connected external system.

## Stack

- Next.js with App Router
- React
- TypeScript in strict mode
- Tailwind CSS
- ESLint
- npm

## Requirements

- Node.js 20.9 or newer
- npm

## Local setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Supabase Auth setup

1. Create or select a Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Set the project values from the Supabase Connect dialog:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

   In production, set the public application origin to:

   ```text
   NEXT_PUBLIC_APP_URL=https://orqelio.kz
   ```

4. In **Authentication → URL Configuration**, set the Site URL to:

   ```text
   http://localhost:3000
   ```

5. Add these local Redirect URLs:

   ```text
   http://localhost:3000/auth/callback?next=%2Fapp
   http://localhost:3000/auth/callback?next=%2Fauth%2Fupdate-password
   http://localhost:3000/auth/callback?next=%2Finvitations%2Faccept%3Ftoken%3D*
   ```

   The second callback establishes the recovery session before the application
   redirects internally to `/auth/update-password`. The third callback keeps
   the one-time administrator invitation token through email confirmation.
   Replace the localhost origin with the exact production origin in production.

6. In **Authentication → Providers**, keep Email authentication enabled and
   choose whether email confirmation is required.
7. In **Authentication → Email Templates**, keep the standard
   `{{ .ConfirmationURL }}` link for both **Confirm signup** and
   **Reset password**. If either template was customized, its action link must
   use:

   ```html
   <a href="{{ .ConfirmationURL }}">Continue</a>
   ```

   This application uses the PKCE authorization-code callback model:

   ```text
   Confirm signup → /auth/callback?code=...&next=/app → /app
   Reset password → /auth/callback?code=...&next=/auth/update-password
                  → /auth/update-password
   ```

8. Run `npm run dev`.

Never commit `.env.local`. The browser may use only the public project URL and
publishable key. A secret or service-role key is not required or used by the
Auth foundation.

## Organizations foundation

Apply the SQL migrations in `supabase/migrations` to the configured project
before using organization routes.

Organization creation is atomic: an `AFTER INSERT` database trigger adds the
authenticated creator as the owner in the same transaction. Row Level Security
allows owners and admins to read their organizations and memberships, while
direct membership writes are denied.

Administrator mutations are exposed only through narrowly scoped RPC
functions. They accept no role value, verify `auth.uid()` against an existing
owner membership, and can only add or remove the `admin` role. The privileged
implementation remains in the non-exposed `private` schema with a fixed empty
`search_path`.

The application supports multiple organizations per user. Every organization
route performs a server-side membership lookup and remains protected by RLS;
an organization ID from the URL is never treated as authorization.

Owners can create seven-day administrator invitations from the organization
administrators page. The database stores only a SHA-256 token hash, and the
raw one-time link is returned only when the invitation is created. Acceptance
requires an authenticated account with the exact invited email and atomically
creates the `admin` membership. Pending invitations can be revoked, active
admins can be removed, and the old direct-add RPC is no longer executable by
authenticated clients.

## CRM integration foundation

Organization workspaces include an Integrations area for owner and admin
members. The CRM section supports provider-neutral development connections and
server-only marketplace entrypoints. It does not activate API access, contact a
CRM API, or copy CRM-owned operational data into Orqelio.

### Altegio entrypoints

The available Altegio catalog action authenticates the user, verifies owner or
admin access to the selected organization, and redirects to the public Orqelio
Marketplace page:

```text
https://app.alteg.io/e/mp_2167_orqelio_ai/
```

No CRM connection is created by this action.

Set Altegio's **Registration Redirect URL** to:

```text
https://orqelio.kz/integrations/altegio/callback
```

The callback requires Supabase authentication and owner or admin access to at
least one organization. It accepts one positive integer `salon_id` or up to 100
positive integer `salon_ids[]` values and only confirms the received location
IDs. It does not choose an organization, create or activate a connection, or
call the Altegio API.

Configure Altegio JSON webhooks at:

```text
https://orqelio.kz/api/webhooks/altegio
```

The endpoint accepts at most 256 KiB, validates the documented
`company_id`, `resource`, `resource_id`, `status`, and `data` envelope, and
stores accepted events as `pending` in an append-only private inbox. Unknown or
disconnected Altegio location IDs are rejected. Browser roles have no table or
RPC access, and no synchronization or business logic runs from this endpoint.

The current official Altegio webhook documentation does not describe a request
signature or verification header. Orqelio therefore does not claim
cryptographic sender authentication. Connection matching and payload
validation reduce exposure but do not prove the sender's identity.

### Legacy YCLIENTS foundation

For YCLIENTS, set the developer dashboard's **Registration Redirect URL** to:

```text
${NEXT_PUBLIC_APP_URL}/integrations/yclients/callback
```

Use the exact deployed HTTPS origin in place of the environment-variable
notation. Locally this resolves to
`http://localhost:3000/integrations/yclients/callback`.

The application creates a ten-minute, caller-bound marketplace attempt and
stores only its SHA-256 state hash in the private schema. The callback accepts
one positive integer `salon_id`, consumes the attempt atomically, and stores
that non-secret identifier in `crm_connections.configuration`. The connection
remains `draft`; API activation is not implemented.

`crm_connections.configuration` accepts only controlled non-secret provider
settings. Credentials, access tokens, API keys, and arbitrary configuration
keys are not supported. Connections cannot be marked `connected` without a
future verified provider flow. The existing encrypted credential table remains
available for future provider requirements but is not used by this marketplace
step.

### YCLIENTS webhook inbox

Configure YCLIENTS to send JSON webhooks to:

```text
https://orqelio.kz/api/webhooks/yclients
```

The endpoint accepts at most 256 KiB and validates only the documented
top-level `company_id`, `resource`, `resource_id`, `status`, and `data` fields.
Accepted events are appended to a private, RLS-protected inbox with a canonical
SHA-256 payload hash and remain `pending`. No synchronization or business logic
runs from this endpoint.

Set `SUPABASE_SECRET_KEY` only in the server deployment environment. It is used
by a narrowly granted webhook writer and must never use the `NEXT_PUBLIC_`
prefix or be committed. Browser roles have neither table privileges nor
permission to execute the writer. Supabase secret keys are elevated credentials
that bypass RLS, so this key must be treated as production infrastructure
secret and rotated immediately if exposed.

The current official YCLIENTS webhook documentation describes the JSON payload
but does not document a request signature or verification header. Orqelio
therefore does not claim sender authentication at this stage. Unknown and
disconnected salon IDs are rejected, but company ID matching is not a
cryptographic authenticity check.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Never commit real secrets. Copy placeholder names from `.env.example` into a
local environment file only when they are needed.

Coding agents must read and follow `AGENTS.md`, the project's primary
architecture and security document, before making changes.
