# Security Summary

## Hardening & Remediation Summary
- **Server-Authoritative Authentication & Session Tokens**: Replaced legacy client-trust auth with server-side `scryptSync` password/PIN verification (`src/server/db.ts`) and HMAC-SHA256 signed bearer session tokens (`server.ts`, signed with `SESSION_SECRET` and verified via `Bearer` header on every privileged API call). Spoofed `x-actor-*` headers without a valid HMAC token are rejected with `401`.
- **Removal of Hardcoded Credentials & Public Secret Leaks**: Removed hardcoded master PINs (`580987`) and deprecated local owner-PIN fallbacks across client and default data modules (`src/utils/defaultData.ts`, `src/utils/storage.ts`, `src/components/LoginRoleModal.tsx`, `src/components/UserManagementView.tsx`). Unauthenticated `GET /api/sync/state` responses redact `customers`, `transactions`, `userAccounts`, `adminPin`, and product `costPrice`.
- **Server-Side Role-Based Access Control (RBAC)**:
  - All `/api/crm/*`, `/api/customers`, `/api/expenses`, `/api/admin/*`, and privileged collection mutation endpoints enforce server-side session identity and granular role/CRM permission flags (`administrator`, `store_manager`, `salesperson`, `customer_support`, `marketing`, `accountant`, plus `CRMPermissions`).
  - Customers cannot access internal CRM/admin endpoints (`403`) or place `time_credit` (Udhar) orders (`403`).
- **Checkout & Coupon Integrity**: `/api/orders/checkout` validates coupon existence, active status, expiration, minimum order amount, and customer ownership server-side inside `BEGIN IMMEDIATE` SQLite transactions; marks redeemed coupons atomically to prevent reuse; recomputes non-privileged order totals from authoritative catalog prices; and enforces `409 Conflict` on duplicate coupon code creation.
- **Consent & Bulk Messaging Controls**: Automated retention rules and bulk CRM campaigns enforce customer `whatsappOptOut` filtering, explicit admin approval flags (`adminApproved` / `canApproveBulkMessages`), dry-run preview mode, and idempotency keys (`crm_automation_logs`) to prevent duplicate dispatch. WhatsApp actions operate honestly via click-to-chat (`wa.me`) without claiming automated API delivery.

---

## PoC Verification

All verification checks were executed end-to-end against the live Express server (`http://127.0.0.1:3000`) and SQLite database (`data/madinamarket.db`) after compilation and lint checks passed, using ephemeral test fixtures that were cleaned up afterward.

| Verification Check | Outcome | Verified Evidence |
| --- | --- | --- |
| Unauthenticated Sync Redaction | Passed (`200`) | `GET /api/sync/state` returned `0` customers, `0` transactions, `0` user accounts, `0` `costPrice`, and omitted `adminPin`. |
| Unauthenticated & Spoofed Header Rejection | Passed (`401`/`403`) | Unauthenticated requests and spoofed `x-actor-id: usr_superadmin` / `x-actor-role: super_admin` headers on `/api/crm/state`, `/api/customers`, and `/api/expenses` were rejected. |
| Invalid Login Credential Rejection | Passed (`401`) | `POST /api/auth/login` rejected invalid PIN attempts with `401`. |
| Customer Self-Registration & Least Privilege | Passed (`200` / `403`) | `POST /api/auth/register-customer` created a hashed customer account and HMAC token; customer login succeeded (`200`), while customer requests to `/api/crm/state` and `time_credit` checkout returned `403`. |
| Support Ticket Creation & Auto SLA | Passed (`200`) | Authenticated customer ticket creation generated `TKT-100D-...` and automatically populated priority-based SLA `dueAt`. |
| Admin CRM Workspace & Catalog Checks | Passed (`200`) | Authenticated admin `/api/crm/state` verified KPI calculations, 13 automation rules, 13 WhatsApp templates, 17 auto segments, and 17 CRM/business reports. |
| Coupon Lifecycle & Loyalty Checkout | Passed (`200` / `409` / `400`) | Coupon creation succeeded (`200`), duplicate coupon creation returned `409`, checkout redeemed coupon (`200`) and awarded loyalty points, and re-using the same coupon on a second checkout returned `400`. |
| Lead Pipeline & Duplicate-Safe Conversion | Passed (`200`) | Converting the same lead twice via `POST /api/crm/leads/:id/convert` linked to the existing customer on the second call (`reusedExisting: true`) with zero duplicate customer rows created. |
| Retention Automation Dry Run & Idempotency | Passed (`200`) | `POST /api/crm/automation/run` matched the newly converted single-order customer in `dryRun: true`, executed once in live mode (`executedCount >= 1`), and skipped on immediate re-run (`skippedDuplicate >= 1`). |
| Report JSON & CSV Export | Passed (`200`) | `GET /api/crm/reports/customer_lifetime_value` (JSON) and `GET /api/crm/reports/monthly_profit_loss_report?format=csv` returned valid structured headers and rows. |
| Non-Destructive Data Preservation | Passed | Record counts before and after test cleanup remained identical (`customers: 2`, `products: 2`, `transactions: 3`, `cod_orders: 2`, `resellers: 2`, `investors: 2`). |
