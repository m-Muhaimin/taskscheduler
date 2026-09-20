# T26 — Web: customer consent chips

## Context (1 line)
Plan `docs/tasks/v2/ui-extended-backend-surfaces.md`; T25 added `phoneVerifiedAt`/`whatsappOptedIn` to the customers API — this task mirrors the two fields in the web types and surfaces them as chips on each customer row.

## Goal
The Customers page shows a small "WhatsApp" (success) chip when a customer opted into WhatsApp fallback and a "Verified" (muted) chip when their phone passed SMS verification — readable at a glance, no behavioral change to search/filter.

## Deliverables

### 1. `apps/web/lib/types.ts` (EDIT — `Customer`, lines 31–37)
Add two OPTIONAL fields (deliberate web-mirror tolerance so `apps/web/lib/fixtures.ts` customer entries — which are `Customer[]`-shaped but unused — and any existing consumers keep compiling regardless):
```ts
export interface Customer {
  id: string;
  name: string;
  phone: string;
  jobCount: number;
  customerSince: string;
  /** When the customer's phone passed SMS verification; null otherwise. */
  phoneVerifiedAt?: string | null;
  /** Customer opted into WhatsApp fallback delivery (read-only here). */
  whatsappOptedIn?: boolean;
}
```
(The API DTO carries these as required — the web mirror staying optional is intentional; `undefined` and `false` render identically.)

### 2. `apps/web/components/dashboard/customers-list.tsx` (EDIT)
- Import `Chip` from `@/components/ui/chip` (check the existing chip component's export name and tone prop values — `tone: "success" | "danger" | "muted"` — and match it).
- Inside the row's text block, directly under the phone line (`</p>` at line 92), add:
```tsx
{(c.whatsappOptedIn || c.phoneVerifiedAt) && (
  <div className="flex flex-wrap gap-1.5 mt-1.5">
    {c.whatsappOptedIn && <Chip tone="success">WhatsApp</Chip>}
    {c.phoneVerifiedAt && <Chip tone="muted">Verified</Chip>}
  </div>
)}
```
- Keep search, highlight, avatar, job count, and layout untouched.

## Hard rules
- No shadcn; `Chip` from the RidgeLine DS only.
- No click handlers, no tooltips, no new page state — static display chips.
- Do not add chips for `whatsappOptedIn: false` / null-verified (only the positive states render).
- No API/web `dashboard-api.ts` changes (the shape already flows through `getCustomers`). No `npm install`. No commit/push.

## Verify
`npm run build --workspace=apps/web` (type-checks `lib/types.ts`, `fixtures.ts`, `customers-list.tsx`, customers page). Optionally boot `npm run dev --workspace=apps/web -p 3100` and confirm chips appear for opted-in/verified customers only. Report to `docs/tasks/v2/reports/T26-web-customers-consent-chips.md` (what shipped, build result, visual check notes).