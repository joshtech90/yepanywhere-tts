package com.yepanywhere.host;

import android.app.*;
import android.content.*;
import android.os.*;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructUtsname;
import java.io.*;
import java.lang.Process;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;

/** Sole runtime owner. Commands are serialized; every async result belongs to a launch. */
public final class HostService extends Service {
    static final String START = "host.start", STOP = "host.stop", RESTART = "host.restart";
    private static volatile CountDownLatch shutdown = new CountDownLatch(0);
    // An unverified process group must never be overlapped by a fresh runtime.
    // Force-stopping the app clears this process-local safety latch.
    private static volatile String cleanupFailure;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile long operation;
    private boolean destroyed, desiredRunning, spawned;
    private String phase = "stopped", detail = "Local host stopped", generation = "";
    private Map<String, String> mappings = Collections.emptyMap();
    private String sharedStorage;
    private Process child;
    private File groupFile;
    private WorkspaceRuntime workspaces;
    private HostResolver resolver;
    private HostSummary summary;
    private JSONObject counts;

    static File state(Context c) { return new File(c.getFilesDir(), "state"); }
    static void status(Context c, String value) {
        try { Files.write(new File(c.getFilesDir(), "host-status.txt").toPath(), value.getBytes(StandardCharsets.UTF_8)); }
        catch (IOException ignored) { }
    }
    static void command(Context context, String action) {
        Intent intent = new Intent(context, HostService.class).setAction(action);
        if (STOP.equals(action)) context.startService(intent); else context.startForegroundService(intent);
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onCreate() {
        super.onCreate();
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("host", "On-device sessions", NotificationManager.IMPORTANCE_LOW));
    }
    private void publish(String next, String message) {
        phase = next; detail = message;
        Bundle value = HostState.snapshot(phase, detail, generation, mappings, sharedStorage); value.putBoolean("spawned", spawned);
        Bundle volumes = new Bundle();
        if (workspaces != null) workspaces.appliedVolumes.forEach(volumes::putString);
        value.putBundle("volumes", volumes); value.putStringArrayList("invalidVolumes", workspaces == null ? new ArrayList<>() : new ArrayList<>(workspaces.invalidVolumes));
        HostState.publish(this, value);
        if (!"stopped".equals(phase) && !"failed".equals(phase)) startForeground(1, notification());
    }
    private PendingIntent activity(int id, Class<?> target, boolean confirm) {
        Intent intent = new Intent(this, target).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (confirm) intent.putExtra("confirmStop", true);
        return PendingIntent.getActivity(this, id, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    private Notification notification() {
        String title = "starting".equals(phase) ? "Starting local host…" : "stopping".equals(phase) ? "Stopping local host…" : "Local host ready";
        if ("ready".equals(phase) && counts != null) {
            if (counts.optInt("attention") > 0) title = getResources().getQuantityString(R.plurals.host_attention, counts.optInt("attention"), counts.optInt("attention"));
            else if (counts.optInt("working") > 0) title = getResources().getQuantityString(R.plurals.host_working, counts.optInt("working"), counts.optInt("working"));
        }
        String text = detail;
        if ("ready".equals(phase)) text = counts == null ? "Session activity unavailable" :
            getString(R.string.host_session_counts, counts.optInt("working"), counts.optInt("attention"));
        Notification.Builder builder = new Notification.Builder(this, "host")
            .setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle(title).setContentText(text)
            .setContentIntent(activity(0, LocalWebActivity.class, false)).setOngoing(true).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(new Notification.Action.Builder(null, "Open", activity(0, LocalWebActivity.class, false)).build())
            .addAction(new Notification.Action.Builder(null, "Host controls", activity(1, HostActivity.class, false)).build());
        if (!"stopping".equals(phase)) builder.addAction(new Notification.Action.Builder(null, "Stop host", activity(2, HostActivity.class, true)).build());
        return builder.build();
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        String action = intent == null ? START : intent.getAction();
        if (STOP.equals(action)) { if ("stopped".equals(phase) || "failed".equals(phase)) stopSelf(); else stop(false); return START_NOT_STICKY; }
        desiredRunning = true;
        if (RESTART.equals(action) && ("ready".equals(phase) || "starting".equals(phase))) stop(true);
        else if ("stopped".equals(phase) || "failed".equals(phase)) launch();
        return START_NOT_STICKY;
    }
    private void launch() {
        long attempt = ++operation; generation = UUID.randomUUID().toString(); counts = null; spawned = false;
        publish("starting", "Starting local host. Saved sessions remain on disk.");
        status(this, "Starting local host. Saved sessions remain on disk.");
        CountDownLatch previous = shutdown;
        worker.execute(() -> {
            try {
                if (!previous.await(8, TimeUnit.SECONDS)) throw new IOException("Previous host shutdown is still pending. Retry from the app.");
                if (attempt != operation) return;
                if (cleanupFailure != null) throw new IOException(cleanupFailure);
                launchRuntime(attempt);
            } catch (Exception error) {
                main.post(() -> { if (!destroyed && attempt == operation) fail("Host unavailable: " + error.getMessage()); });
            }
        });
    }
    private void launchRuntime(long attempt) throws Exception {
            File root = new File(getFilesDir(), "runtime");
            if (!new File(root, "opt/host/launch.mjs").isFile()) {
                throw new IOException("Runtime not installed. Use the developer provisioning command.");
            }
            File home = state(this); home.mkdirs();
            File tmp = new File(getCacheDir(), "proot"); tmp.mkdirs();
            String lib = getApplicationInfo().nativeLibraryDir;
            StructUtsname uts = Os.uname();
            // PRoot's full UTS format changes only the guest hostname. Keep
            // the real kernel/architecture and leave hardware capabilities
            // unchanged (-1); no Android hostname or namespace is modified.
            String guestKernel = "\\" + uts.sysname + "\\ya-phone\\" + uts.release
                + "\\" + uts.version + "\\" + uts.machine + "\\localdomain\\-1\\";
            {
                if (attempt != operation) return;
                resolver = new HostResolver(this);
                workspaces = new WorkspaceRuntime(getApplicationContext(), () -> main.post(() -> {
                    if (!destroyed && attempt == operation) publish(phase, detail);
                }));
                sharedStorage = workspaces.sharedSource == null ? null : workspaces.sharedSource.toString();
                mappings = Collections.unmodifiableMap(new HashMap<>(workspaces.applied));
            }
            List<String> command = new ArrayList<>(Arrays.asList(
                lib + "/libproot.so", "--kill-on-exit", "--link2symlink", "-i", "1000:1000", "-k", guestKernel,
                "-r", root.toString(), "-b", "/dev", "-b", "/proc", "-b", "/sys",
                "-b", new File(root, "opt/host/hosts") + ":/etc/hosts",
                "-b", new File(root, "opt/host/hostname") + ":/etc/hostname",
                "-b", resolver.file + ":/etc/resolv.conf",
                "-b", home + ":/home/user"));
            workspaces.bind(command);
            command.addAll(Arrays.asList("-w", "/home/user", "/usr/bin/env", "-i",
                "YEP_ANDROID_SAF_SOCKET=" + workspaces.socket, "YEP_ANDROID_HOST_PORT=" + HostConnection.PORT,
                "HOME=/home/user", "USER=user", "LOGNAME=user", "SHELL=/bin/bash", "HOSTNAME=ya-phone", "LANG=C.UTF-8", "PATH=/usr/bin:/bin",
                "/usr/bin/node", "/opt/host/launch.mjs"));
            // Own a session/process group so Stop reaches tracees too. Killing
            // only the PRoot tracer can leave Node and providers orphaned.
            File pidFile = File.createTempFile("host-group-", ".pid", getCacheDir());
            List<String> grouped = new ArrayList<>(Arrays.asList(
                "/system/bin/setsid", "/system/bin/sh", "-c",
                "printf '%s' \"$$\" > \"$1\"; shift; exec \"$@\"",
                "ya-host", pidFile.toString()));
            grouped.addAll(command);
            ProcessBuilder builder = new ProcessBuilder(grouped);
            builder.directory(getFilesDir());
            builder.environment().clear();
            builder.environment().put("PROOT_LOADER", lib + "/libproot-loader.so");
            builder.environment().put("PROOT_TMP_DIR", tmp.toString());
            builder.environment().put("LD_LIBRARY_PATH", lib);
            builder.redirectErrorStream(true);
            Process process;
            {
                if (attempt != operation) { pidFile.delete(); return; }
                groupFile = pidFile;
                child = process = builder.start();
            }
            status(this, "Host process started. Open Yep Anywhere when ready.");
            main.post(() -> { if (!destroyed && attempt == operation) { spawned = true; publish("starting", "Starting local host. Waiting for authenticated readiness…"); } });
            process.getOutputStream().close();
            new Thread(() -> {
                try (InputStream in = process.getInputStream(); OutputStream log = new FileOutputStream(new File(getFilesDir(), "host.log"))) {
                    byte[] bytes = new byte[4096]; int n, total = 0;
                    while ((n = in.read(bytes)) >= 0) {
                        int keep = Math.min(n, Math.max(0, 1024 * 1024 - total)); log.write(bytes, 0, keep); total += keep;
                    }
                    int result = process.waitFor();
                    main.post(() -> { if (!destroyed && attempt == operation) fail("Host exited (" + result + "). Saved sessions remain on disk."); });
                } catch (Exception error) {
                    main.post(() -> { if (!destroyed && attempt == operation) fail("Host connection lost. Saved sessions remain on disk."); });
                }
            }, "ya-host-output").start();
            long deadline = SystemClock.uptimeMillis() + 45000;
            while (attempt == operation && process.isAlive() && SystemClock.uptimeMillis() < deadline) {
                String token = HostConnection.ready(this);
                if (token != null) {
                    main.post(() -> {
                        if (destroyed || attempt != operation) return;
                        publish("ready", "Local host ready");
                        summary = new HostSummary(token, value -> {
                            if (destroyed || attempt != operation || !"ready".equals(phase)) return;
                            if (Objects.equals(String.valueOf(counts), String.valueOf(value))) return;
                            counts = value; getSystemService(NotificationManager.class).notify(1, notification());
                        });
                    }); return;
                }
                Thread.sleep(250);
            }
            if (attempt == operation) throw new IOException("Local host did not become ready. Retry from the app.");
    }
    private void fail(String message) {
        desiredRunning = false; stop(false, message);
    }
    private void stop(boolean restart) { stop(restart, null); }
    private void stop(boolean restart, String failure) {
        desiredRunning = restart;
        if ("stopping".equals(phase)) return;
        long attempt = ++operation;
        if (summary != null) { summary.close(); summary = null; } counts = null;
        publish("stopping", "Stopping local host. Active agent work is interrupted.");
        status(this, "Stopping local host. Saved sessions remain on disk.");
        worker.execute(() -> {
            String error = cleanup();
            main.post(() -> {
                if (destroyed || attempt != operation) return;
                mappings = Collections.emptyMap(); sharedStorage = null; spawned = false;
                if (error != null) desiredRunning = false;
                if (desiredRunning) { launch(); return; }
                String reason = error != null ? error : failure;
                stopForeground(STOP_FOREGROUND_REMOVE);
                publish(reason == null ? "stopped" : "failed", reason == null ? "Local host stopped. Saved sessions remain on disk." : reason);
                status(this, reason == null ? "Stopped. Saved sessions remain on disk." : reason);
                stopSelf();
            });
        });
    }
    /** Called only by the serial worker, including external service destruction. */
    private String cleanup() {
        String failure = null;
        if (resolver != null) { resolver.close(); resolver = null; }
        if (workspaces != null) { workspaces.close(); workspaces = null; }
        if (child != null) {
            try {
                String value = "";
                for (int attempt = 0; attempt < 100; attempt++) {
                    if (groupFile != null && groupFile.isFile()) value = new String(Files.readAllBytes(groupFile.toPath()), StandardCharsets.US_ASCII).trim();
                    if (!value.isEmpty() || !child.isAlive()) break;
                    Thread.sleep(10);
                }
                if (!value.matches("[1-9][0-9]*")) throw new IOException("Missing runtime process group");
                int group = Integer.parseInt(value);
                try { Os.kill(-group, OsConstants.SIGTERM); } catch (android.system.ErrnoException gone) { if (gone.errno != OsConstants.ESRCH) throw gone; }
                Thread.sleep(2000);
                try { Os.kill(-group, OsConstants.SIGKILL); } catch (android.system.ErrnoException gone) { if (gone.errno != OsConstants.ESRCH) throw gone; }
            } catch (Exception error) { failure = "Host shutdown could not be verified. Stop the app before restarting."; }
            finally {
                child.destroyForcibly();
                try { if (!child.waitFor(3, TimeUnit.SECONDS)) failure = "Host shutdown did not finish. Stop the app before restarting."; }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); failure = "Host shutdown interrupted"; }
                child = null;
            }
        }
        if (groupFile != null) groupFile.delete(); groupFile = null;
        if (failure != null) cleanupFailure = failure;
        return failure;
    }
    @Override public void onDestroy() {
        destroyed = true; operation++; desiredRunning = false;
        if (summary != null) summary.close();
        CountDownLatch completion = new CountDownLatch(1); shutdown = completion;
        String endingGeneration = generation;
        worker.execute(() -> {
            String error = cleanup();
            main.post(() -> {
                Bundle value = HostState.read(this);
                if (endingGeneration.equals(value.getString("generation")) && !"failed".equals(value.getString("phase")))
                    HostState.publish(this, HostState.snapshot(error == null ? "stopped" : "failed", error == null ? "Local host stopped. Saved sessions remain on disk." : error, endingGeneration, Collections.emptyMap(), null));
            });
            completion.countDown();
        });
        worker.shutdown(); stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }
}
