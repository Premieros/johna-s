# Johna-S ↔ AGENT — customer service onboarding

## Current status
- GitHub branch: `feature/agent-customer-support-onboarding` (not on production `main` until reviewed).
- Site: https://premieros.github.io/johna-s/
- Existing Johna-S Supabase: `azzdesuowpdcoflmyezn` (unchanged).
- AGENT service: independent AGENT Supabase project. Never reuse Premier's public widget key.
- The external chat is disabled until a valid public key is configured via the GitHub Actions **repository variable** `VITE_AGENT_SUPPORT_WIDGET_KEY`.
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
1. On GitHub, open `Premieros/johna-s → Settings → Secrets and variables → Actions → Variables`.
2. Create repository variable `VITE_AGENT_SUPPORT_WIDGET_KEY` and paste the **Johna-S-specific public key** (48 hexadecimal characters). This is a public browser key, not a secret.
3. Confirm PR verification passes before merging. The GitHub Pages workflow only publishes a commit after the existing `Verify main` checks complete successfully.
4. A new successful verified main deployment will then bundle the key, and a small customer chat button appears for signed-in Johna-S users.
5. If the key is blank or invalid, the widget does not load. Remove the GitHub variable and redeploy a verified commit to disable future widget injection.

## Security and limitations
- AGENT isolates conversations/knowledge by its own project and widget `public_key` and validates incoming browser `Origin`.
- The frontend does not transmit the Johna-S Supabase access token, password, or business data to AGENT.
- On the same browser tab, a changed employee identity clears the previous widget session to prevent another user inheriting an older chat.
- The standard AGENT embedded widget keeps a tab-scoped `sessionStorage` session, **not** persistent cross-device conversation continuity. The previous custom Premier widget has extra features and is not reused here.
- The widget is an unprivileged help chat, not an administrative backdoor or access to database records. It does **not** automatically read the screen or report employee identity/branch.
- The JavaScript endpoint is `https://premieros-agent-support-public.vercel.app/support/widget.js`; the AGENT Preview control panel remains separately protected.
- Allowed origin is `https://premieros.github.io` because the site is deployed under a GitHub Pages subpath. In this hosting model other GitHub Pages projects on the same host share the browser origin; use separate keys and do not treat origin alone as user authentication.
- Do not merge until the project's own AGENT key has been created and the full check suite is green. Do not modify production databases or financial/inventory records as part of onboarding.

## Verification
1. Log in to `https://premieros.github.io/johna-s/` with a non-admin staff account.
2. Open the customer-service bubble, send `السلام عليكم` and then `أين أجد المخزون؟`.
3. AGENT → `/support/conversations` should show only the **Johna-S** conversation under its separate project. Premier conversations remain under Premier.
4. Sign out and log in as a **different** employee in the same tab. Confirm the previous conversation is not shown.
5. Remove the variable and run a verified deploy to test a simple rollback.
