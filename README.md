# Warrane Door Shifts

> A full-stack shift management platform built for **Warrane College, UNSW Sydney** - replacing excel rosters and messenger chains with a live scheduling system that handles claiming, swapping, and payout tracking.

![Next.js](https://img.shields.io/badge/Next.js_16-App_Router-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss)
![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-black?logo=vercel)

---

## Overview

Warrane College runs a weekly door-shift roster where student volunteers claim, swap, and track shifts across a 11-week trimester. Before this app, coordination happened through spreadsheets and group chats - leading to missed shifts, disputed payouts, and admin overhead.

This application digitises the entire lifecycle:

```
Open Shift → Claim Request → Admin Approval → Active Shift → Payout Tracking
```

It is live in production, actively used by college members each trimester.

---

## Features

### For Members
- **Interactive calendar** - week-strip navigation + 24-hour timeline view with colour-coded shift states
- **One-click claiming** - claim individual weeks or an entire term's worth of the same slot in a single modal
- **Shift swaps** - request whole-shift or partial (time-range) swaps with any other member
- **My Shifts** - track pending, approved, and rejected claims; cancel or modify swap requests
- **Payouts** - view completed shifts with calculated earnings ($20/hr regular, $30 flat night shift)
- **Live "Currently on Door"** indicator with animated pulse on today's view
- **Secure accounts** - bcrypt-hashed passwords; accounts work passwordless until a password is set

### For Admins
- **Approval dashboard** - review all pending claims and swap requests in one place
- **Batch actions** - approve or reject many requests at once with a single button
- **Assign modal** - directly assign any shift to any member, including partial-time assignments
- **Payout management** - date-range filtered payout view per member, with one-click Excel export
- **Auto-conflict resolution** - approving one claim auto-rejects all competing claims for the same shift

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, React 19) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | Supabase (PostgreSQL) |
| Auth | Client-side via localStorage + bcryptjs |
| Deployment | Vercel |

---

## Architecture Highlights

### Fake-UTC Timezone Model
All shift times are stored as "fake UTC" - the AEST/AEDT local clock hour is used directly as the UTC value. This sidesteps the complexity of daylight-saving conversions entirely:

```ts
// "4:00 PM AEST" is stored as T16:00:00Z
// All display uses getUTCHours() - never getHours()

function getSydneyParts(d = new Date()) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney", ...
  }).formatToParts(d);
}
```

This means the calendar, time comparisons, and payout calculations all remain consistent regardless of where the server or client is located.

### Role-Based Access
Three roles - `admin`, `staff`, and `member` - each see a different navigation and have different capabilities. Role checks are enforced both client-side (UI gating) and at the database level via Supabase Row Level Security policies.

### Partial Swap Logic
When a swap covers only part of a shift (e.g. someone takes 6 PM–10 PM of a 4 PM–midnight slot):
1. The original shift is trimmed to the requester's remaining portion
2. A new shift row is inserted for the swapped time range
3. The target member's approved claim is created on the new shift
4. If the DB insert fails, the system falls back to a whole-shift transfer - no orphaned data

### Concurrent Data Fetching
All multi-query views use `Promise.all` to fetch in parallel, keeping page load times low even with 3–4 dependent queries per view.

```ts
const [{ data: pendingClaims }, { data: approvedClaims }, { data: pendingSwaps }] =
  await Promise.all([...]);
```

---

## Project Structure

```
app/
  page.tsx              # Home - mounts the Calendar
  login/page.tsx        # Two-step login (username → password)
  my-shifts/page.tsx    # Member's claim history + swap management
  payouts/page.tsx      # Member's payout breakdown
  profile/page.tsx      # Account settings + password management
  admin/
    page.tsx            # Admin approval dashboard + assign modal
    payouts/page.tsx    # Aggregate payouts with Excel export

components/
  Calender.tsx          # Main calendar (week strip + timeline + claim modal)
  SwapModal.tsx         # Whole-shift and partial swap request modal
  TopBar.tsx            # Navigation + user menu

lib/
  supabase.ts           # Supabase client singleton
```

---

## Database Schema

```sql
users     (id, username, first_name, last_name, role, password_hash)
shifts    (id, start_at, end_at, status, category)
claims    (id, shift_id, user_id, username, claimant_name, status)
swaps     (id, shift_id, requester_username, target_username,
           requester_name, target_name, custom_start_at, custom_end_at, status)
```

---

## Local Development

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) project

### Setup

```bash
git clone https://github.com/your-username/warrane-door-shifts.git
cd warrane-door-shifts
npm install
```

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=url
NEXT_PUBLIC_SUPABASE_ANON_KEY=key
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Supabase Setup

Run the following in the Supabase SQL editor to enable partial swaps:

```sql
-- Allow shift inserts (required for partial swap logic)
CREATE POLICY "Allow shift inserts"
  ON public.shiftsDoor FOR INSERT TO public WITH CHECK (true);

-- Prevent double-approvals at the database level
CREATE UNIQUE INDEX one_approved_claim_per_shift
  ON claimsDoor (shift_id)
  WHERE status = 'approved';
```

---

## Key Design Decisions

**Why client-side auth?** The college has no existing identity provider and the user base is small and trusted. A lightweight localStorage approach with bcrypt password hashing gives adequate security without the complexity of OAuth or JWT infrastructure.

**Why not server actions?** All data mutations go through the Supabase JS client directly from the browser. This keeps the architecture simple and lets Supabase RLS handle access control at the database layer, avoiding a separate API surface.

**Why fake-UTC?** Australia observes daylight saving, which means the UTC offset shifts mid-year. Storing times as fake-UTC (local clock = UTC) means a "5 PM shift" is always `T17:00:00Z` regardless of season - no conversion logic needed anywhere in the codebase.

---
