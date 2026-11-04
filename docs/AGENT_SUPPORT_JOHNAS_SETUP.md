# Johna-S ↔ AGENT — customer service onboarding

## Current status
- GitHub branch: `feature/agent-customer-support-onboarding` (not on production `main` until reviewed).
- Site: https://premieros.github.io/johna-s/
- Existing Johna-S Supabase: `azzdesuowpdcoflmyezn` (unchanged).
- AGENT service: independent AGENT Supabase project. Never reuse Premier's public widget key.
- Johna-S's approved **public** widget identifier is pinned in `src/components/AgentCustomerSupport.tsx`. There are no secret keys or GitHub variables to configure.
- The login remains Johna-S's own login. There is no AGENT login prompt for staff or customers to use the chat.

## One-time AGENT setup
1. Log into AGENT's **projects and knowledge**: https://premieros-ai-sales-agent-git-feature-3d3de3-sayedalaa82285-7634.vercel.app/support
2. Create a separate project:
   - Name: `Johna-S`
   - Slug: `johna-s`
   - Assistant instructions: `أنت خدمة عملاء Johna-S. استخدم قاعدة المعرفة الخاصة بهذا المشروع فقط. لا تخلط بينه وبين Premier. أجب بالعربية بشكل مهني، ولا تختلق بيانات حسابات أو أسعار أو سياسات غير مؤكدة. عند صعوبة الإجابة، قدم خطوات آمنة ووجّه المستخدم إلى الدعم البشري.`
3. Under **Add information**, upload `docs/AGENT_SUPPORT_JOHNAS_KNOWLEDGE_AR.txt` with the title **دليل مشروع Johna-S**.
4. Under **Add the chat to any website**, add the allowed **origin** `https://premieros.github.io` (no `/johna-s/` path). The origin is the host, shared by repositories under `premieros.github.io`. The 48-hex public key is unique per project. **Never use the Premier key**.
5. Copy the generated public widget key from AGENT.

## GitHub Pages integration
1. The Johna-S widget public key `8e299da0ef520017d2c74c4e688109dd0dda3b48cee20f2d` is configured in the support component. There are no secrets to paste.
2. Confirm the AGENT site entry `https://premieros.github.io` is enabled under the **Johna-S** project, not Premier.
3. Confirm all GitHub PR checks pass. The GitHub Pages workflow publishes only after `Verify main` succeeds.
4. After merge and verified deployment, signed-in Johna-S users will see the support chat.
5. To disable support, remove the `<AgentCustomerSupport />` component from `src/app/App.tsx` and redeploy a verified commit.

## Security and limitations
- AGENT isolates conversations/knowledge by its own project and widget `public_key` and validates incoming browser `Origin`.
- The frontend does not transmit the Johna-S Supabase access token, password, or business data to AGENT.
- On the same browser tab, a changed employee identity clears the previous widget session to prevent another user inheriting an older chat.
- The standard AGENT embedded widget keeps a tab-scoped `sessionStorage` session, **not** persistent cross-device conversation continuity. The previous custom Premier widget has extra features and is not reused here.
- The widget is an unprivileged help chat, not an administrative backdoor or access to database records. It does **not** automatically read the screen or report employee identity/branch.
- The JavaScript endpoint is `https://premieros-agent-support-public.vercel.app/support/widget.js`; the AGENT Preview control panel remains separately protected.
- Allowed origin is `https://premieros.github.io` because the site is deployed under a GitHub Pages subpath. In this hosting model other GitHub Pages projects on the same host share the browser origin; use separate keys and do not treat origin alone as user authentication.
- The dedicated public key is set; do not merge unless AGENT origin registration is confirmed and the full check suite is green. Do not modify production databases or financial/inventory records as part of onboarding.

## Verification
1. Log in to `https://premieros.github.io/johna-s/` with a non-admin staff account.
2. Open the customer-service bubble, send `السلام عليكم` and then `أين أجد المخزون؟`.
3. AGENT → `/support/conversations` should show only the **Johna-S** conversation under its separate project. Premier conversations remain under Premier.
4. Sign out and log in as a **different** employee in the same tab. Confirm the previous conversation is not shown.
5. Remove the variable and run a verified deploy to test a simple rollback.

## One conversation — AGENT and human support (2026-11-04)
- The customer opens **one** `خدمة العملاء` widget. All customer messages, AI responses, and support staff replies use the same AGENT `support_conversations.id` and `support_messages` rows.
- Johna-S superadmin: open `#/super-admin` → **دعم العملاء**. The inbox is embedded inside the same dashboard and uses the existing Johna-S Supabase session; no AGENT login is requested.
- New conversations use `mode=ai`. To reply personally, press **استلام المحادثة**, write the message, then **إرسال**. When finished, press **إعادة الرد إلى AGENT**.
- Customers can explicitly request a support person. When AGENT cannot generate a response, the same thread is transferred to human mode rather than creating another chat.
- The customer widget refreshes message history while opened; staff replies appear in the **same** conversation, with no separate human chat window.
- Superadmin access is verified **server-side** using Johna-S Auth and the persisted `users.role=super_admin`/active profile. The server scopes every read/write to the Johna-S widget and project; never accept an AGENT API key or visitor token as admin authorization.
- The Johna-S Supabase publishable key is set **server-side** on AGENT Preview as `JOHNAS_SUPABASE_PUBLISHABLE_KEY`, never committed to Git. AGENT service-role remains server-side.
- The history API authenticates widget visitors by the original conversation ID + securely generated visitor token. It never returns another user's thread merely because they share the GitHub Pages hostname.
- If no conversation is present, ask a signed-in employee to send a first test question; then open the superadmin inbox. Confirm customer → AI response → admin takeover → admin response → AGENT release → AI response all appear in the original thread.
- The Johna-S website remains unmodified on `main` until all mandatory `Verify main` jobs pass and the PR is deliberately merged. The customer widget makes no changes to sales, inventory, finance or production tables.
