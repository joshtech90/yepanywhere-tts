package com.yepanywhere.host;

import android.app.*;
import android.content.*;
import android.os.*;
import android.service.notification.StatusBarNotification;
import java.io.File;
import java.nio.file.Files;
import java.util.*;
import org.json.*;

/** Disposable fixture only: real service, PRoot, IPC and notification integration. */
public final class HostControlsProbe extends Instrumentation {
    private android.content.Context context;
    private final JSONArray evidence = new JSONArray();
    @Override public void onCreate(Bundle args) { start(); }
    private Bundle state() { return HostState.read(context); }
    private void command(String action) { runOnMainSync(() -> HostService.command(context, action)); }
    private Bundle await(String phase) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 60000;
        while (SystemClock.uptimeMillis() < deadline) {
            Bundle state = state();
            if (phase.equals(state.getString("phase"))) {
                evidence.put(new JSONObject().put("phase", phase).put("generation", state.getString("generation"))); return state;
            }
            if ("failed".equals(state.getString("phase"))) throw new IllegalStateException(state.getString("detail"));
            Thread.sleep(50);
        }
        throw new IllegalStateException("State deadline: " + phase + "; current " + state().getString("detail"));
    }
    private Notification notification() {
        for (StatusBarNotification value : context.getSystemService(NotificationManager.class).getActiveNotifications())
            if (value.getId() == 1) return value.getNotification();
        throw new IllegalStateException("Foreground notification missing");
    }
    private android.view.accessibility.AccessibilityNodeInfo visibleText(String text) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 5000;
        while (SystemClock.uptimeMillis() < deadline) {
            android.view.accessibility.AccessibilityNodeInfo root = getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).getRootInActiveWindow();
            if (root != null) {
                java.util.List<android.view.accessibility.AccessibilityNodeInfo> matches = root.findAccessibilityNodeInfosByText(text);
                if (!matches.isEmpty()) return matches.get(0);
            }
            Thread.sleep(20);
        }
        throw new IllegalStateException("Notification action did not show: " + text);
    }
    @Override public void onStart() {
        Bundle result = new Bundle(); context = getTargetContext();
        try {
            if (!"stopped".equals(state().getString("phase"))) throw new IllegalStateException("Fixture must start stopped");
            command(HostService.START); command(HostService.START);
            Bundle ready = await("ready"); String first = ready.getString("generation");
            if (!ready.getBoolean("spawned")) throw new IllegalStateException("Ready before runtime spawn");
            Notification notification = notification();
            if (notification.actions.length != 3) throw new IllegalStateException("Missing notification actions");
            if (!"Open".contentEquals(notification.actions[0].title) || !"Host controls".contentEquals(notification.actions[1].title) || !"Stop host".contentEquals(notification.actions[2].title))
                throw new IllegalStateException("Unexpected notification actions");
            long summaryDeadline = SystemClock.uptimeMillis() + 10000;
            while (!notification().extras.getCharSequence(Notification.EXTRA_TEXT).toString().contains("Working: 0") && SystemClock.uptimeMillis() < summaryDeadline) Thread.sleep(50);
            if (!notification().extras.getCharSequence(Notification.EXTRA_TEXT).toString().contains("Working: 0")) throw new IllegalStateException("Actual YA summary did not reach notification");
            notification.actions[0].actionIntent.send(); // Cross-process WebView opens the actual host.
            Thread.sleep(250);
            if (!first.equals(state().getString("generation"))) throw new IllegalStateException("Open restarted healthy host");
            notification.actions[2].actionIntent.send();
            visibleText("Stop local host?");
            if (!visibleText("Cancel").performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)) throw new IllegalStateException("Cannot cancel notification Stop");
            notification.actions[1].actionIntent.send(); visibleText("Workspace folders");
            if (!"ready".equals(state().getString("phase"))) throw new IllegalStateException("Stop skipped confirmation");
            command(HostService.RESTART); await("stopping");
            long stoppingDeadline = SystemClock.uptimeMillis() + 5000;
            while (!notification().extras.getCharSequence(Notification.EXTRA_TITLE).toString().contains("Stopping") && SystemClock.uptimeMillis() < stoppingDeadline) Thread.sleep(20);
            if (!notification().extras.getCharSequence(Notification.EXTRA_TITLE).toString().contains("Stopping")) throw new IllegalStateException("Stopping notification is stale");
            command(HostService.RESTART);
            Bundle restarted = await("ready");
            if (first.equals(restarted.getString("generation"))) throw new IllegalStateException("Restart did not replace generation");
            Thread.sleep(250);
            if (!restarted.getString("generation").equals(state().getString("generation"))) throw new IllegalStateException("Repeated restart was not coalesced");
            command(HostService.STOP); await("stopped");
            long removalDeadline = SystemClock.uptimeMillis() + 5000;
            while (context.getSystemService(NotificationManager.class).getActiveNotifications().length != 0 && SystemClock.uptimeMillis() < removalDeadline) Thread.sleep(20);
            if (context.getSystemService(NotificationManager.class).getActiveNotifications().length != 0) throw new IllegalStateException("Stopped notification remained");
            command(HostService.START); await("starting"); command(HostService.STOP); await("stopped");
            command(HostService.START); Bundle overlapping = await("ready");
            command(HostService.STOP); await("stopping"); command(HostService.START);
            if (overlapping.getString("generation").equals(await("ready").getString("generation"))) throw new IllegalStateException("Start during Stop did not replace launch");
            command(HostService.STOP); await("stopped");
            Files.write(new File(context.getFilesDir(), "host-controls.json").toPath(), new JSONObject().put("states", evidence).put("passed", true).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            result.putString("stream", "HOST_CONTROLS_PASS\n");
        } catch (Exception error) { result.putString("stream", "HOST_CONTROLS_FAILED " + error + "\n"); }
        finally { command(HostService.STOP); }
        finish(result.getString("stream", "").contains("HOST_CONTROLS_PASS") ? -1 : 1, result);
    }
}
