package com.yepanywhere.host;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.widget.*;
import java.net.HttpURLConnection;
import java.util.concurrent.*;
import org.json.*;

/** Native host controls derive actions from authority, never old diagnostic text. */
public final class HostActivity extends Activity {
    private TextView status;
    private Button start, open, stop, notifications, battery, folders, codex, claude;
    private HostState.Watch watch;
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(1), new ThreadPoolExecutor.DiscardOldestPolicy());
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private Future<?> pending;
    private CancellationSignal query;
    private int generation;
    private boolean visible;
    private Button button(LinearLayout layout, String title, Runnable action) {
        Button button = new Button(this); button.setText(title); button.setAllCaps(false);
        button.setOnClickListener(view -> action.run()); layout.addView(button); return button;
    }
    private void web(String provider) {
        Intent intent = new Intent(this, LocalWebActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (provider != null) intent.putExtra("provider", provider); startActivity(intent);
    }
    private void command(String action) {
        try { HostService.command(this, action); }
        catch (RuntimeException error) { Toast.makeText(this, "Host command failed: " + error.getMessage(), Toast.LENGTH_LONG).show(); }
    }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int)(20 * getResources().getDisplayMetrics().density); layout.setPadding(pad, pad, pad, pad);
        TextView heading = new TextView(this); heading.setText(R.string.host_heading); heading.setTextSize(22); layout.addView(heading);
        status = new TextView(this); status.setTextIsSelectable(true); layout.addView(status);
        open = button(layout, "Open Yep Anywhere", () -> web(null));
        start = button(layout, "Start local host", () -> command(HostService.START));
        stop = button(layout, "Stop local host", this::confirmStop);
        codex = button(layout, "Set up Codex", () -> web("codex"));
        claude = button(layout, "Set up Claude", () -> web("claude"));
        folders = button(layout, "Workspace folders", () -> startActivity(new Intent(this, WorkspacesActivity.class).putExtra("initialTree", getIntent().getStringExtra("initialTree"))));
        notifications = button(layout, "Notifications", this::notificationSettings);
        battery = button(layout, "Battery optimization", this::batterySettings);
        TextView remote = new TextView(this); remote.setText(R.string.host_planned); layout.addView(remote);
        ScrollView scroll = new ScrollView(this); scroll.addView(layout);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom); return insets;
        }); setContentView(scroll); confirmationIntent();
    }
    private void confirmStop() {
        Bundle state = HostState.read(this);
        if (!HostState.active(state)) { Toast.makeText(this, "Host is already stopped or stopping", Toast.LENGTH_SHORT).show(); return; }
        new AlertDialog.Builder(this).setTitle("Stop local host?")
            .setMessage("This interrupts active agent work. Saved sessions and sign-ins stay on disk.")
            .setNegativeButton("Cancel", null).setPositiveButton("Stop host", (dialog, which) -> command(HostService.STOP)).show();
    }
    private void confirmationIntent() {
        if (getIntent().getBooleanExtra("confirmStop", false)) { getIntent().removeExtra("confirmStop"); confirmStop(); }
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); confirmationIntent(); }
    private void notificationSettings() {
        boolean requested = getPreferences(MODE_PRIVATE).getBoolean("notificationRequested", false);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            (!requested || shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("notificationRequested", true).apply();
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1); return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = manager.getNotificationChannel("host");
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
        if (manager.areNotificationsEnabled() && channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE)
            intent.setAction(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_CHANNEL_ID, "host");
        startActivity(intent);
    }
    @android.annotation.SuppressLint("BatteryLife")
    private void batterySettings() {
        if (getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName())) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); return;
        }
        new AlertDialog.Builder(this).setTitle("Keep sessions running")
            .setMessage("Allow background operation so sessions can continue with the screen off. This may increase battery usage; Android can still stop the app.")
            .setNegativeButton("Not now", null).setPositiveButton("Continue", (dialog, which) ->
                startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())))).show();
    }
    private void refresh() {
        if (!visible) return;
        Bundle state = HostState.read(this); String phase = state.getString("phase", "stopped");
        status.setText(getString(R.string.host_status, state.getString("detail")));
        start.setText("starting".equals(phase) ? "Starting local host…" : "ready".equals(phase) ? "Local host running" : "stopping".equals(phase) ? "Stopping local host…" : "Start local host");
        start.setEnabled(!HostState.active(state) && !"stopping".equals(phase));
        stop.setEnabled(HostState.active(state));
        open.setText("ready".equals(phase) ? "Open Yep Anywhere" : "starting".equals(phase) ? "Open when ready" : "Start and open Yep Anywhere");
        NotificationManager manager = getSystemService(NotificationManager.class); NotificationChannel channel = manager.getNotificationChannel("host");
        boolean appAllowed = manager.areNotificationsEnabled();
        boolean channelAllowed = channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
        notifications.setText(appAllowed && channelAllowed ? "Notifications: On\nManage notifications" : appAllowed ? "Host notifications: Off\nOpen channel settings" : "Notifications: Off\nEnable notifications");
        boolean exempt = getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName());
        battery.setText(exempt ? "Battery optimization: Exempt\nManage battery settings" : "Battery optimization: Optimized\nAllow background operation");
        codex.setText(getString(R.string.host_two_lines, "Set up Codex", "ready".equals(phase) ? "Checking sign-in…" : "Sign-in status unavailable"));
        claude.setText(getString(R.string.host_two_lines, "Set up Claude", "ready".equals(phase) ? "Checking sign-in…" : "Sign-in status unavailable"));
        refreshDetails(state);
    }
    private void refreshDetails(Bundle state) {
        int attempt = ++generation;
        if (query != null) query.cancel(); if (pending != null) pending.cancel(true);
        CancellationSignal signal = new CancellationSignal(); query = signal;
        pending = worker.submit(() -> {
            ScheduledFuture<?> deadline = timer.schedule(signal::cancel, 15, TimeUnit.SECONDS);
            try {
                JSONArray roots = new WorkspaceRegistry(this).status(signal, HostState.mappings(state)); int unhealthy = 0;
                for (int i = 0; i < roots.length(); i++) {
                    JSONObject root = roots.getJSONObject(i);
                    if (!root.optBoolean("safAvailable") || (root.optBoolean("direct") && !root.optBoolean("directAvailable"))) unhealthy++;
                }
                java.util.Map<String, String> desired = new java.util.HashMap<>();
                for (int i = 0; i < roots.length(); i++) { JSONObject root = roots.getJSONObject(i); if (root.optBoolean("directAvailable")) desired.put(root.getString("name"), root.getString("tree")); }
                JSONObject storage = WorkspaceRuntime.sharedStatus(this, state.getString("shared"));
                String source = storage.optBoolean("available") ? storage.optString("source") : null;
                java.util.Map<String, String> appliedVolumes = HostState.mappings(state, "volumes"), desiredVolumes = new java.util.HashMap<>();
                java.util.Set<String> invalidVolumes = HostState.invalidVolumes(state);
                JSONArray volumes = WorkspaceRuntime.volumeStatus(this, appliedVolumes, invalidVolumes);
                for (int i = 0; i < volumes.length(); i++) { JSONObject volume = volumes.getJSONObject(i); if (volume.optBoolean("available")) desiredVolumes.put(volume.getString("id"), volume.getString("source")); }
                boolean changed = "ready".equals(state.getString("phase")) && (!desired.equals(HostState.mappings(state)) ||
                    !java.util.Objects.equals(source, state.getString("shared")) || !desiredVolumes.equals(appliedVolumes) || !invalidVolumes.isEmpty());
                String label = "Workspace folders\n" + roots.length() + " saved" + (volumes.length() > 0 ? " · " + volumes.length() + " removable" : "") + (unhealthy > 0 ? " · " + unhealthy + " need attention" : "") + (changed ? " · Restart needed" : "");
                runOnUiThread(() -> { if (visible && attempt == generation) folders.setText(label); });
            } catch (Exception unavailable) { runOnUiThread(() -> { if (visible && attempt == generation) folders.setText("Workspace folders\nFolder status unavailable"); }); }
            finally { deadline.cancel(false); }
            if (!"ready".equals(state.getString("phase")) || Thread.currentThread().isInterrupted()) return;
            HttpURLConnection connection = null;
            try {
                connection = HostConnection.open("/api/providers", HostConnection.token(HostService.state(this)), 5000);
                if (connection.getResponseCode() != 200) throw new java.io.IOException("Provider state unavailable");
                String data;
                try (java.io.InputStream input = connection.getInputStream()) {
                    java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
                    byte[] buffer = new byte[4096]; int size;
                    while ((size = input.read(buffer)) != -1) {
                        output.write(buffer, 0, size);
                        if (output.size() > 1024 * 1024) throw new java.io.IOException("Provider response too large");
                    }
                    data = new String(output.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
                }
                JSONArray providers = new JSONObject(data).getJSONArray("providers");
                runOnUiThread(() -> {
                    if (!visible || attempt != generation) return;
                    codex.setText("Set up Codex\nProvider unavailable"); claude.setText("Set up Claude\nProvider unavailable");
                    for (int i = 0; i < providers.length(); i++) {
                        JSONObject provider = providers.optJSONObject(i); if (provider == null) continue;
                        String name = provider.optString("name"); Button target = "codex".equals(name) ? codex : "claude".equals(name) ? claude : null;
                        if (target == null) continue;
                        String display = "codex".equals(name) ? "Codex" : "Claude";
                        target.setText(getString(R.string.host_two_lines, (provider.optBoolean("authenticated") ? "Manage " : "Set up ") + display,
                            !provider.optBoolean("installed") ? "CLI unavailable" : provider.optBoolean("authenticated") ? "Signed in" : "Sign-in needed"));
                    }
                });
            } catch (Exception unavailable) {
                runOnUiThread(() -> { if (visible && attempt == generation) { codex.setText("Set up Codex\nSign-in status unavailable"); claude.setText("Set up Claude\nSign-in status unavailable"); } });
            } finally { if (connection != null) connection.disconnect(); }
        });
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) { super.onRequestPermissionsResult(request, permissions, grants); refresh(); }
    @Override public void onResume() { super.onResume(); visible = true; watch = new HostState.Watch(this, this::refresh); refresh(); }
    @Override public void onPause() { visible = false; generation++; if (watch != null) { watch.close(); watch = null; } if (query != null) query.cancel(); if (pending != null) pending.cancel(true); super.onPause(); }
    @Override public void onDestroy() { worker.shutdownNow(); timer.shutdownNow(); super.onDestroy(); }
}
