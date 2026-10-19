package com.yepanywhere.host;

import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;

/** No activity: prove an ordinary app UID cannot use the debug ADB entry points. */
public final class AdbAuthorizationProbe extends Instrumentation {
    @Override public void onCreate(Bundle args) { start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            if (getTargetContext().checkSelfPermission("android.permission.DUMP") == PackageManager.PERMISSION_GRANTED)
                throw new IllegalStateException("Probe must not have DUMP authority");
            for (String pkg : new String[] { "com.yepanywhere.host.experimental", "com.yepanywhere.host.lab" }) {
                // Ensure package visibility cannot turn a missing target into a passing refusal.
                getTargetContext().getPackageManager().getPackageInfo(pkg, 0);
                try {
                    getTargetContext().startService(new Intent("host.stop").setComponent(
                        new ComponentName(pkg, "com.yepanywhere.host.HostService")));
                    throw new IllegalStateException("Service accepted ordinary UID: " + pkg);
                } catch (SecurityException expected) {
                    if (!expected.getMessage().contains("android.permission.DUMP")) throw expected;
                }
                try {
                    getTargetContext().getContentResolver().call(Uri.parse("content://" + pkg + ".host-state"), "snapshot", null, null);
                    throw new IllegalStateException("Provider accepted ordinary UID: " + pkg);
                } catch (SecurityException expected) {
                    if (!expected.getMessage().contains("android.permission.DUMP")) throw expected;
                }
            }
            result.putString("result", "Both hosts refused service and snapshot access without DUMP; no activity opened");
            finish(-1, result);
        } catch (Exception error) {
            result.putString("error", error.toString()); finish(0, result);
        }
    }
}
