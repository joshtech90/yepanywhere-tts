"""Run inside a claimed, English-language macOS Machine Control guest.

From the checkout, under a common CLI claim or scoped run:
  machine-control os -- python3 -c "$(cat packages/desktop/scripts/updater-macos-idle-smoke.py)" --app /guest/path/YepAnywhere.app

Requires an installed app current on its selected channel. Does not install
updates or change channels. The default wait crosses macOS's hidden-webview
suspension threshold; shorter waits only exercise ordinary window restoration.
"""

import argparse
import json
from pathlib import Path
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--app", required=True)
parser.add_argument("--idle-seconds", type=float, default=360)
args = parser.parse_args()
control = str(Path.home() / "bin/machine-control")
target = "com.yepanywhere.desktop"
started = time.monotonic()


def report(event, **data):
    print(json.dumps({"elapsed": round(time.monotonic() - started, 2),
                      "event": event, **data}), flush=True)


def call(**request):
    result = json.loads(subprocess.check_output(
        [control, json.dumps(request)], text=True, timeout=20))
    assert result["accepted"], result
    return result


def press(label):
    snapshot = call(operation="snapshot", target=target, query=label)
    element = next(element for element in snapshot["data"]["elements"]
                   if element.get("label") == label and element.get("enabled"))
    call(operation="action", reference=element["reference"], action="press")


def check_current(case):
    press("Check for Updates")
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        result = call(operation="snapshot", target=target, query="latest version")
        values = [element.get("value") for element in result["data"]["elements"]]
        if "You are running the latest version on this channel." in values:
            assert result["data"]["application"]["active"], "Updater not foreground"
            report("passed", case=case)
            return
        time.sleep(0.5)
    raise AssertionError(f"{case}: no visible up-to-date result")


applications = call(operation="applications")["data"]["applications"]
assert not any(app.get("bundleId") == target for app in applications), (
    "Quit the existing Yep Anywhere instance before this test")
subprocess.run(["open", str(Path(args.app))], check=True)
try:
    time.sleep(10)
    press("Close Window")
    report("waiting_hidden", seconds=args.idle_seconds)
    time.sleep(args.idle_seconds)
    check_current("hidden after idle")
    press("Hide YepAnywhere")
    check_current("application hidden")
    press("Minimize")
    check_current("updater minimized")
    press("Close Window")
    check_current("updater closed")
finally:
    press("Quit")
