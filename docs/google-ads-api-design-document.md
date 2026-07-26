# Hundreds — Google Ads API Design Document

**Application name:** Hundreds (SEO Hundreds)  
**Document version:** 1.0  
**Date:** June 2026  
**API version:** Google Ads API v20  
**Access requested:** Basic Access (read-only reporting)  
**Application submitted:** 2026-06-13  
**Status as of 2026-06-25:** Pending Google review (developer token still Test Account Access)

---

## 1. Application overview

Hundreds is a web application that helps small business owners who are not professional marketers. Users connect their own Google Ads account via OAuth, alongside other marketing data sources (Google Analytics, Meta Ads, Shopify). Hundreds reads recent campaign performance and uses it—together with the user’s stated business goal—to generate a plain-English 8-week marketing action plan.

Hundreds does **not** create, edit, pause, or bid on campaigns. It does **not** manage budgets or billing. All Google Ads API usage is **read-only reporting** to personalize recommendations shown only to the authenticated account owner.

**Website (production):** To be provided at launch (currently developed and tested locally).  
**Contact:** API contact email registered in Google Ads API Center.

---

## 2. Why we use the Google Ads API

| User need | How Google Ads API helps |
|-----------|---------------------------|
| “What should I do next?” | Recent spend, clicks, conversions, and top campaigns inform plan actions |
| Trust in recommendations | Plan text cites the user’s real numbers, not generic advice |
| One place for marketing | Ads data is combined with Analytics and other channels in one workspace |

Without the API, users would manually copy metrics from the Ads UI. The API allows automated, read-only snapshots when the user requests a new plan.

---

## 3. Google Ads API operations used

| Operation | Method | Purpose | Write? |
|-----------|--------|---------|--------|
| `customers:listAccessibleCustomers` | GET | Let user pick which Ads customer account to link | No |
| `customers/{customerId}/googleAds:search` | POST (GAQL) | Read campaign metrics for last 30 days | No |

**GAQL example (read-only):**

```sql
SELECT campaign.name, metrics.cost_micros, metrics.conversions,
       metrics.clicks, metrics.impressions
FROM campaign
WHERE segments.date DURING LAST_30_DAYS
ORDER BY metrics.cost_micros DESC
LIMIT 15
```

**Not used:** CampaignService, AdGroupService, mutate operations, billing, recommendations apply, or any administrative writes.

**Estimated volume:** Low. One search request per plan generation per workspace, typically a few times per week per active user. Well under Basic Access daily limits.

---

## 4. Architecture

```
┌─────────────┐     OAuth 2.0      ┌──────────────────┐
│  End user   │ ─────────────────► │  Google Ads      │
│  (browser)  │ ◄───────────────── │  (Google)        │
└──────┬──────┘     access token    └──────────────────┘
       │
       │ HTTPS
       ▼
┌─────────────┐                    ┌──────────────────┐
│  Hundreds    │  developer-token   │  Google Ads API  │
│  Web + API  │ ─────────────────► │  v20 (read-only) │
└──────┬──────┘                    └──────────────────┘
       │
       ▼
┌─────────────┐
│  Postgres   │  Encrypted OAuth tokens, selected customer ID,
│  (Supabase) │  generated plan JSON (no raw API dump stored long-term)
└─────────────┘
```

**Components:**

- **Web app (Next.js):** Login, Integrations UI, goal input, plan display.
- **API server (Node.js):** OAuth callback, token storage, snapshot service, plan generation.
- **Database:** Per-organization isolation; one Google Ads connection per workspace.

---

## 5. Authentication and authorization

1. User signs in to Hundreds (Supabase Auth).
2. User clicks **Connect Google Ads** on Integrations.
3. Google OAuth 2.0 with scope `https://www.googleapis.com/auth/adwords`.
4. User selects an accessible customer account; ID is saved in workspace settings.
5. Access and refresh tokens are encrypted at rest (`ENCRYPTION_KEY`).
6. API calls use the user’s OAuth access token plus our **developer token** in headers.
7. Users only see data for accounts they authorized; workspaces are isolated by `organization_id`.

Tokens are refreshed automatically before expiry. Users can disconnect at any time (tokens deleted).

---

## 6. Data handling and privacy

| Data | Retention | Shared with third parties? |
|------|-----------|----------------------------|
| OAuth tokens | Until user disconnects | No (stored encrypted) |
| Customer ID | Until user changes/disconnects | No |
| Campaign snapshot text | Embedded in plan generation prompt; summary in plan JSON | Anthropic Claude API for plan text generation only |
| Full API responses | Not persisted as separate exports | No |

- Users must authenticate; no public access to Ads data.
- We do not sell or resell Google Ads data.
- Plan generation sends a **text summary** of metrics to our AI provider to write recommendations; users are informed they connect third-party services.
- Compliance with Google Ads API Terms of Service and OAuth policies.

---

## 7. User flow (Google Ads)

1. User creates a workspace (organization).
2. User connects Google Ads via OAuth.
3. User selects customer account → status **Ready**.
4. User enters a marketing goal and starts **New plan**.
5. Backend runs read-only GAQL snapshot (last 30 days).
6. Snapshot text is included in an internal prompt; Claude returns a structured 8-week plan.
7. User views plan in the app; no changes are made in Google Ads.

---

## 8. Security

- HTTPS for all web and API traffic.
- Secrets (developer token, encryption key, DB credentials) in server environment variables only—not in client code.
- Multi-tenant access control: every API request requires authenticated user + workspace membership.
- Read-only API integration in v1; no mutate endpoints implemented.

---

## 9. Future scope (not in v1)

Possible later features (each would require separate review and user approval):

- Gated campaign suggestions with explicit user approval before any write.
- Scheduled report refresh.

**v1 commitment:** Read-only reporting via `googleAds:search` and `listAccessibleCustomers` only.

---

## 10. Summary

Hundreds uses the Google Ads API solely to **read** campaign performance for authenticated small business users and to **personalize marketing plans** inside our application. We request **Basic Access** to query production accounts that users explicitly connect. We do not automate ad creation, bidding, or budget changes.

**Applicant:** Hundreds / SEO Hundreds  
**Document prepared for:** Google Ads API Basic Access application  
**Submitted:** 2026-06-13 · **Pending review as of:** 2026-06-25
