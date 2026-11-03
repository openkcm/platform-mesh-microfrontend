# L1 action browser check

Run `npm ci` and `npm run dev -- --host 127.0.0.1` from `ui/`.
Open `http://127.0.0.1:5174/tests/fixtures/l1-slot-actions.html`.
The fixture runs the real Keys page with UI5 buttons and local API responses.
It never sends a request to a live environment.

1. Set the viewport width to 1280, 1440, 1600, then 1920 pixels.
2. Select **Check labels** at each width.
3. Confirm the PASS result and capture a screenshot.
4. Confirm that Configure, Deactivate, and Activate show full labels. Delete uses an icon.
5. Select **Revoke role elsewhere**, then **Refresh window focus** to send a window focus event.
6. Confirm that all L1 write buttons disappear. Confirm that Create Domain Key remains.
7. Select **Restore role and focus**, then **Deny next write**.
8. Select the AWS Delete icon and confirm Delete.
9. Confirm that the error appears and all L1 write buttons disappear.
10. Restore the role. Open **L1 Key Managers fixture**, then select **Revoke** for the current user.
11. Select **Keys**. Confirm that all L1 write buttons disappear without a reload.

Capture the browser session as a video, or combine the screenshots into a video.
The unit tests cover pending checks, stale grants, failed checks, and context changes.

## Compact empty slots

Use `?configured=0`, `?configured=2`, or `?configured=6` to select the configured slot count.
Add `&allowed=false` to remove the L1 write permission.
Run `node scripts/capture-empty-slots.mjs` from `ui/` for the automated headless checks.
See `docs/evidence/empty-l1-slots/` for the screenshots and reproduction steps.
