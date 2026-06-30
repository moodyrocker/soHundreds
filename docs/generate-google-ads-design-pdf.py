#!/usr/bin/env python3
"""Generate Google Ads API design document PDF for Basic Access application."""

from pathlib import Path

from fpdf import FPDF

OUT = Path(__file__).parent / "google-ads-api-design-document.pdf"


class Doc(FPDF):
    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(100, 100, 100)
        self.cell(0, 10, f"Hundreds Google Ads API Design Document  |  Page {self.page_no()}", align="C")


def section(pdf: Doc, title: str, body: str) -> None:
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(40, 40, 40)
    pdf.multi_cell(0, 5, body)
    pdf.ln(3)


def main() -> None:
    pdf = Doc()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 10, "Hundreds - Google Ads API Design Document", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 6, "Application: Hundreds (SEO Hundreds)  |  Version 1.0  |  June 2026", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, "Google Ads API v20  |  Requested access: Basic (read-only reporting)", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    section(
        pdf,
        "1. Application overview",
        "Hundreds is a web application for small business owners who are not professional "
        "marketers. Users connect their own Google Ads account via OAuth. Hundreds reads recent "
        "campaign performance and combines it with the user's business goal to generate a "
        "plain-English 8-week marketing action plan.\n\n"
        "Hundreds does NOT create, edit, pause, or bid on campaigns. It does NOT manage budgets "
        "or billing. All Google Ads API usage is read-only reporting to personalize "
        "recommendations shown only to the authenticated account owner.",
    )

    section(
        pdf,
        "2. Purpose of Google Ads API use",
        "Users need actionable marketing advice grounded in their real ad performance. The API "
        "provides automated read-only snapshots (spend, clicks, conversions, top campaigns) when "
        "a user requests a new plan. This avoids manual copy-paste from the Ads UI and allows "
        "plans to cite actual metrics with appropriate confidence levels.",
    )

    section(
        pdf,
        "3. API operations used (read-only)",
        "Operation 1: customers:listAccessibleCustomers (GET)\n"
        "  - Purpose: Let the user select which Ads customer account to link to their workspace.\n"
        "  - Write access: No.\n\n"
        "Operation 2: customers/{customerId}/googleAds:search (POST, GAQL)\n"
        "  - Purpose: Read campaign name, cost, conversions, clicks, impressions for LAST_30_DAYS.\n"
        "  - Write access: No.\n"
        "  - Typical query limits results to 15 campaigns ordered by spend.\n\n"
        "NOT used: CampaignService mutate, AdGroupService mutate, billing, budget changes, "
        "automated bidding, or any administrative write operations.\n\n"
        "Estimated API volume: Low. Approximately one search request per plan generation per "
        "workspace, a few times per week per active user. Well under Basic Access daily limits.",
    )

    section(
        pdf,
        "4. System architecture",
        "End user (browser)\n"
        "  -> OAuth 2.0 with Google (adwords scope)\n"
        "  -> Hundreds Web App (Next.js) over HTTPS\n"
        "  -> Hundreds API Server (Node.js)\n"
        "       -> Google Ads API v20 (developer-token + user OAuth token)\n"
        "       -> PostgreSQL database (Supabase): encrypted tokens, customer ID, plan JSON\n"
        "       -> Anthropic Claude API: plan text generation from metric summary only\n\n"
        "Each customer workspace (organization) is isolated. Users only access data for accounts "
        "they personally authorized through Google OAuth.",
    )

    section(
        pdf,
        "5. Authentication and authorization",
        "1. User signs in to Hundreds (email/password via Supabase Auth).\n"
        "2. User initiates Connect Google Ads from the Integrations page.\n"
        "3. Google OAuth 2.0 authorization with scope https://www.googleapis.com/auth/adwords.\n"
        "4. User selects an accessible customer account; customer ID is stored per workspace.\n"
        "5. Access and refresh tokens are encrypted at rest using AES-256 (application encryption key).\n"
        "6. API requests include the user's OAuth bearer token and our developer token.\n"
        "7. Users can disconnect at any time; stored tokens are deleted.\n"
        "8. All API routes require authenticated user plus verified workspace membership.",
    )

    pdf.add_page()

    section(
        pdf,
        "6. Data handling and privacy",
        "OAuth tokens: Stored encrypted until user disconnects. Not shared with third parties.\n"
        "Customer ID: Stored per workspace until changed or disconnected.\n"
        "Campaign metrics: Fetched on demand; summarized as text for plan generation. Full API "
        "responses are not exported or resold.\n"
        "AI processing: A text summary of metrics is sent to Anthropic Claude to generate plan "
        "recommendations. Users connect integrations knowingly.\n"
        "Compliance: Google Ads API Terms of Service and Google OAuth policies are followed. "
        "We do not sell or redistribute Google Ads data.",
    )

    section(
        pdf,
        "7. End-user flow",
        "1. User creates or joins a workspace.\n"
        "2. User connects Google Ads via OAuth and selects a customer account.\n"
        "3. User enters a marketing goal and starts a new plan.\n"
        "4. Backend executes read-only GAQL snapshot (last 30 days).\n"
        "5. Snapshot text is included in an internal prompt; AI returns a structured 8-week plan.\n"
        "6. User views the plan in the application. No changes are made in Google Ads.",
    )

    section(
        pdf,
        "8. Security measures",
        "HTTPS for all client and server communication.\n"
        "Developer token and encryption keys stored in server environment variables only.\n"
        "Multi-tenant isolation: organization_id on all data; X-Organization-Id header on API calls.\n"
        "Version 1 is read-only: no mutate endpoints are implemented or planned without explicit "
        "user approval flows in a future phase.",
    )

    section(
        pdf,
        "9. Future scope (not included in v1)",
        "Possible future features (subject to separate review and explicit user approval):\n"
        "- Scheduled metric refresh\n"
        "- User-approved campaign changes with audit log\n\n"
        "Version 1 commitment: Read-only reporting via listAccessibleCustomers and "
        "googleAds:search only.",
    )

    section(
        pdf,
        "10. Summary for Google Ads API review",
        "Hundreds uses the Google Ads API solely to READ campaign performance for authenticated "
        "small business users and to personalize marketing plans inside our application. We "
        "request Basic Access to query production accounts that users explicitly connect. We do "
        "not automate ad creation, bidding, budget changes, or account administration.\n\n"
        "Applicant: Hundreds / SEO Hundreds\n"
        "Prepared for: Google Ads API Basic Access application",
    )

    pdf.output(str(OUT))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
