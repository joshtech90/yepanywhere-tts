# Experimental preview Refresh can leave a relay source unavailable

During the real encrypted multi-host preview E2E, clicking Beta's Refresh after
receiving a finalized native message left Beta unavailable while Alpha and Gamma
remained connected. The selected Beta snapshot remained visible but stopped
updating, and the catalog retained its previous timestamps. This occurred with
the production remote bundle and isolated local relay/server profiles.

Reproduction seam: `packages/client/e2e/conversation-preview.spec.ts`, after
switching to issue grouping, click Beta's Refresh before selecting None. The
attempt to await `data-source-status=ready` passed, but the later failure snapshot
showed Beta unavailable. A transient ready state is therefore insufficient
evidence that the refresh completed durably. The transport failure cause has not
yet been established.

Checked 2026-09-14: the browser regression now renames Beta through its real
metadata API, refreshes its catalog, then appends a native message and requires
that message to arrive while Alpha and Gamma remain ready. Two consecutive
refreshes passed in None grouping. A second run passed two refreshes with the
reported issue → Refresh → None sequence. Both used the production remote
bundle and real encrypted relay connections. No transport implementation was
changed, and this does not prove the original intermittent incident is fixed.

The next failing run needs close/error evidence from `PreviewController.include`
and its saved-host relay mux connection owner, correlated with the selected
conversation. Keep the regression's fresh catalog and later live-update checks;
a transient ready state alone cannot close this report. Grouping remains local
metadata work and must not reconnect.

Found 2026-09-12 while adding None (recent activity) to the experimental preview.
