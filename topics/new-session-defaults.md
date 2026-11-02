# New-session defaults

Settings > Model controls the provider, model and thinking effort used to open
new session forms. These preferences are server-scoped and shared by clients
connected to that server. Existing sessions are unaffected.

**Last used settings** preserves the established behavior: successful Cockpit
launches remember their choices; the standard form remembers explicit changes.
An absent `newSessionDefaults.selectionMode` also uses this behavior.

**Fixed defaults** keeps the choices configured in Settings. A different
provider, model, effort or other option in New Session applies to that session
only. Returning to New Session starts from the configured defaults again.
Settings remains the explicit place to change those defaults in either mode.

Both launch forms preserve the fixed policy. Changing the policy itself does
not reset the saved provider/model choices. Providers still validate whether
a chosen model and effort are available. No personal model is a product default.

The `new-session-selection-mode` capability advertises that the settings
parser preserves `newSessionDefaults.selectionMode` (`last-used` or `fixed`).
The hosted client hides this control and omits the field when unsupported.
The stable compatibility corpus through v0.11.0 lacks this capability; it keeps
its established automatic remembering. No existing capability is broadened.
