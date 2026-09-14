# Debugging

[Contributor guide](../../DEVELOPMENT.md) · [Development docs](README.md)

Commands and code paths below are relative to the repository root unless stated
otherwise.

## Server Logs

Server logs are written to `{dataDir}/logs/` (default: `~/.yep-anywhere/logs/`):

- `server.log` - Main server log (dev mode with `pnpm dev`)
- `e2e-server.log` - Server log during E2E tests

To view logs in real-time: `tail -f ~/.yep-anywhere/logs/server.log`

All `console.log/error/warn` output is captured. Logs are JSON format in the file but pretty-printed to console.

Environment variables:
- `LOG_DIR` - Custom log directory
- `LOG_FILE` - Custom log filename (default: server.log)
- `LOG_LEVEL` - Minimum level: fatal, error, warn, info, debug, trace (default: info)
- `LOG_FILE_LEVEL` - Separate level for file logging (default: same as LOG_LEVEL)
- `LOG_TO_FILE` - Set to "true" to enable file logging (default: off)
- `LOG_PRETTY` - Set to "false" to disable pretty console logs (default: on)

## Client Console Logs

Remote collection of browser `console.log/warn/error` from mobile clients. Useful for debugging connection issues on devices where you can't open DevTools.

**Enable:** Developer Mode settings → "Remote Log Collection" toggle.

**Storage:** `{dataDir}/logs/client-logs/` (default: `~/.yep-anywhere/logs/client-logs/`). One JSONL file per device per day, named `client-{YYYY-MM-DD}-{deviceId}.jsonl`. The device UUID is persisted in the client's `localStorage`.

Each line is a single log event:
```json
{"timestamp":1770790157738,"level":"log","prefix":"[SecureConnection]","message":"[SecureConnection] Closed: 1006","_receivedAt":1770790161477}
```

A `[ClientInfo]` entry is written on each session start with user agent, screen size, DPR, and language.

```bash
# List device log files
ls ~/.yep-anywhere/logs/client-logs/

# View today's logs for a device
cat ~/.yep-anywhere/logs/client-logs/client-$(date +%Y-%m-%d)-<deviceId>.jsonl

# Follow incoming logs
tail -f ~/.yep-anywhere/logs/client-logs/*.jsonl
```

**Implementation:** `packages/client/src/lib/diagnostics/ClientLogCollector.ts` (client), `packages/server/src/routes/client-logs.ts` (server `POST /api/client-logs`).

## Maintenance Server

A separate lightweight HTTP server can run on PORT + 1 (conventionally 3401) for out-of-band diagnostics, which is exactly when the main server is unresponsive. It is **off unless `MAINTENANCE_PORT` names a port** — set it at launch, because a server that is already wedged cannot be told to open it.

```bash
# Check server status
curl http://localhost:3401/status

# Enable proxy debug logging at runtime
curl -X PUT http://localhost:3401/proxy/debug -d '{"enabled": true}'

# Change log levels at runtime
curl -X PUT http://localhost:3401/log/level -d '{"console": "debug"}'

# Enable Chrome DevTools inspector
curl -X POST http://localhost:3401/inspector/open
# Then open chrome://inspect in Chrome

# Trigger server restart
curl -X POST http://localhost:3401/reload
```

Available endpoints:
- `GET /health` - Health check
- `GET /status` - Memory, uptime, connections
- `GET|PUT /log/level` - Get/set log levels
- `GET|PUT /proxy/debug` - Get/set proxy debug logging
- `GET /inspector` - Inspector status
- `POST /inspector/open` - Enable Chrome DevTools
- `POST /inspector/close` - Disable Chrome DevTools
- `POST /reload` - Restart server

Environment variables:
- `MAINTENANCE_PORT` - Port for maintenance server (default: 0, meaning no maintenance server; PORT + 1 is the usual choice)
- `PROXY_DEBUG` - Enable proxy debug logging at startup (default: false)
