# Refine Ignite login wording

- Preserve the main welcome text, green Ignite branding and single Continue securely action.
- Replace embedded-browser guidance with the requested device-neutral wording; keep warnings limited to detected embedded browsers, excluding the Ignite native app.
- Keep Internet Identity attribution small, muted and text-only, with no ICP logo.
- Make sign-in error guidance platform-neutral too, without changing authentication or redirects.

## Verification
- Run focused presentation and redirect tests, including ordinary browsers, native app, PWA and embedded browsers.
- Check the updated warning in the preview; real-device authentication remains outside available testing.

## Technical scope
Presentation copy and regression checks only; no changes to provider invocation, principal mapping, account creation, invites or session persistence.