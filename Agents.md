# Project rules for Codex (read before editing)

## Project
Curated Car Rentals website (Next.js App Router + TypeScript + Tailwind).
Local dev: `npm run dev` → http://localhost:3000

## Goal (current phase)
Build the FRONTEND template first (no backend/DB integration yet).
We are creating a professional car rental site skeleton similar to curatedcarrentals.com, then enhancing it.

## Workflow rules (very important)
- Work in **small steps**.
- Make changes in **batches** (max 2–4 files per batch).
- After each batch:
  1) Summarize what changed
  2) Tell me exactly how to verify in the browser
  3) STOP and wait for the next instruction
- Ensure all steps in the requested task are completed, then review the work once finished to confirm every task item is done.

## Do
- Keep changes minimal and consistent with existing styling.
- Use Tailwind (already configured).
- Prefer Server Components unless interactivity is required (then use `"use client"`).
- Use clean, readable code and simple component structure.
- Keep routes/pages inside `src/app/*`.

## Don’t
- Don’t add new libraries/packages unless I explicitly ask.
- Don’t change build config (Next/Netlify) unless absolutely required.
- Don’t touch Prisma/DB/migrations in this phase.
- Don’t remove existing pages/sections unless requested.

## Frontend scope for this phase
Create/maintain these files:
- `src/lib/utils.ts`
- `src/data/{vehicles.ts, services.ts, content.ts}`
- `src/components/ui/Button.tsx`
- `src/components/site/{Container.tsx, Header.tsx, Footer.tsx}`
- `src/components/sections/{SectionHeading.tsx, VehicleCard.tsx}`
- Pages:
  - `src/app/page.tsx` (Home)
  - `src/app/fleet/page.tsx`
  - `src/app/book/page.tsx` (template booking UI showing deposit + balance)
  - `src/app/services/page.tsx`
  - `src/app/tourist-destinations/page.tsx`
  - `src/app/about/page.tsx`
  - `src/app/contact/page.tsx`
- Update `src/app/layout.tsx` to include Header + Footer.

## Booking/payment note
- UI is template-only.
- Deposit is shown as “due now”, balance as “due on pickup”.
- Do not implement real payment yet.

## Definition of done (for each batch)
- No TypeScript errors.
- `npm run dev` runs successfully.
- You clearly state what pages to open to verify (e.g., `/fleet`, `/book`).

## PROCESS RULE (MANDATORY WORKFLOW)
- Implement tasks in order.
- After implementation, explicitly review against the Acceptance Checklist (below).
- If any task was skipped or incomplete:
   - complete skipped task(s)
   - run the checklist again
- Repeat until all checklist items pass.
- Provide final summary:
   - files changed
   - migrations added
   - how to test manually (step-by-step)
