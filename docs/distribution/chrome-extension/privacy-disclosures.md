# Chrome Web Store privacy fields

These answers were saved for the actual 0.1.3 package and submitted on
2026-10-14, including the new `contextMenus` justification. Review them against
each later package before submission. The console has fields for all four
install permissions; the optional per-site host-access explanation is included
in the `activeTab` justification.

**Single purpose:** Let users supervise coding-agent sessions on their own Yep
Anywhere servers and find the sessions related to a GitHub issue, pull request
or Jira ticket beside the page they are reviewing.

| Permission | Justification |
| --- | --- |
| `sidePanel` | Display related coding-agent sessions beside the current browser tab. |
| `storage` | Save extension preferences and a local saved-host login mirror so the worker can resume the user's selected hosts on demand. Temporary tab/lookup state uses session storage. No credentials use Chrome sync. |
| `activeTab` | A toolbar click reads that tab's URL for an explicit issue/ticket lookup. No page content is injected or read. |
| `contextMenus` | Adds "Open Yep Anywhere", "Open Yep Anywhere in a popup window" and "Open the side panel" to the toolbar button's right-click menu. No menu is added to web pages. |
| Optional `https://*/*`, `http://*/*` | Users can run GitHub Enterprise or Jira at their own addresses. Access is requested for one selected site at runtime, to observe that site's issue/ticket URLs for automatic lookup and the badge. No site access is granted at install. |

**Remote code:** No. Application JavaScript, fonts, styles, the worker and side
panel are bundled. Servers supply application data over the encrypted relay;
that data is not extension code. HTML artifact previews are unavailable in this
release. No remotely hosted script or `eval` permission is requested.

**Data categories used:** Personally identifiable information (host/login
identifiers), authentication information (login/resume material), web history
(selected issue/ticket URLs), user activity (server actions), personal communications (submitted agent
conversations), and website
content (session transcripts, prompts and displayed project information).
Select these categories conservatively: local use and user-directed server
processing are disclosed, even though there is no analytics collection.
Health, financial/payment and location data are not independently collected
by the extension. Users control arbitrary prompt content.

**Certifications:** Data is not sold or transferred for advertising; it is used
only for the extension's single purpose and is not used for creditworthiness or
lending decisions. User-selected hosts, their configured AI providers, and
optional GitHub/Jira metadata integrations are the operational destinations.
Do not characterize encrypted relay processing as an absence of all metadata.

**Privacy policy:** [Published repository policy](https://github.com/kzahel/yepanywhere/blob/main/docs/distribution/chrome-extension/privacy.md).

**Reviewer access:** Use the existing isolated Yep Anywhere evaluation server
and sample account, recorded privately in the dotfiles `machines/laptop/yep-review/README.md` runbook.
Put its server name and password in the console's restricted Username/Password
fields, and its relay URL and steps in Additional instructions, never in this
repository or the listing. Explain how to choose **Open Yep Anywhere** from the
panel, use the owner login (limited-user username empty), view a sample project
and session, and find it in the panel's Recent sessions. A reviewer does
not need a paid provider account. Verify that host's availability before review
submission; do not offer the short-lived screenshot fixture as reviewer access.
