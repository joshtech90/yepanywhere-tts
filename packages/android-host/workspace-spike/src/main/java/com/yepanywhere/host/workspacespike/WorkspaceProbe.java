package com.yepanywhere.host.workspacespike;

import android.app.Instrumentation;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.system.Os;
import android.system.OsConstants;
import dev.machinecontrol.android.storage.LocalWorkspace;
import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Executes the shared payload under this disposable app's real UID. */
public final class WorkspaceProbe extends Instrumentation {
    private static String read(File file) throws java.io.IOException {
        return new String(Files.readAllBytes(file.toPath()), java.nio.charset.StandardCharsets.UTF_8);
    }
    private static String readSentinel(InputStream input) throws java.io.IOException {
        byte[] bytes = new byte[64]; int n = input.read(bytes);
        return new String(bytes, 0, Math.max(0, n), java.nio.charset.StandardCharsets.UTF_8);
    }
    private Bundle arguments;
    @Override public void onCreate(Bundle values) { arguments = values; start(); }
    @Override public void onStart() {
        Bundle result = new Bundle(); int code = 1; Process process = null; File pidFile = null;
        try {
            Context context = getTargetContext();
            JSONObject selection = new JSONObject(read(new File(context.getFilesDir(), "selection.json")));
            if ("authority".equals(arguments.getString("phase"))) {
                // Diagnostic only: deliberately bypass admission to distinguish
                // raw Android authority from the fixture's SAF admission policy.
                File admitted = new File(read(new File(context.getFilesDir(), "admitted-path.txt")));
                boolean readable;
                try (InputStream input = new java.io.FileInputStream(new File(admitted, "selection-witness.txt"))) {
                    readable = arguments.getString("sentinel", "").equals(readSentinel(input));
                } catch (java.io.IOException error) { readable = false; }
                JSONObject authority = new JSONObject().put("rawReadable", readable)
                    .put("allFiles", android.os.Environment.isExternalStorageManager());
                Files.write(new File(context.getFilesDir(), "authority.json").toPath(), authority.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                result.putString("stream", "WORKSPACE_PASS authority\n"); finish(-1, result); return;
            }
            Uri tree = Uri.parse(selection.getString("tree"));
            File workspace = LocalWorkspace.resolve(context, tree);
            // A controller-created synthetic sentinel independently witnesses the
            // same bytes through both Android document and raw-path authority.
            String sentinel = arguments.getString("sentinel", "");
            if (!sentinel.matches("[a-f0-9]{32}")) throw new IllegalArgumentException("Fresh sentinel required");
            String id = DocumentsContract.getTreeDocumentId(tree) + "/selection-witness.txt";
            Uri document = DocumentsContract.buildDocumentUriUsingTree(tree, id);
            try (InputStream input = context.getContentResolver().openInputStream(document)) {
                if (input == null || !sentinel.equals(readSentinel(input)) ||
                    !sentinel.equals(read(new File(workspace, "selection-witness.txt")))) {
                    throw new IllegalStateException("SAF and direct-path byte identity differs");
                }
            }
            File state = new File(context.getFilesDir(), "state"), root = new File(context.getFilesDir(), "runtime");
            File tmp = new File(context.getCacheDir(), "proot"); tmp.mkdirs();
            ConnectivityManager networks = context.getSystemService(ConnectivityManager.class);
            LinkProperties links = networks.getLinkProperties(networks.getActiveNetwork());
            if (links == null || links.getDnsServers().isEmpty()) throw new IllegalStateException("No active DNS servers");
            StringBuilder dns = new StringBuilder();
            for (java.net.InetAddress address : links.getDnsServers()) dns.append("nameserver ").append(address.getHostAddress()).append('\n');
            File resolver = new File(state, "resolv.conf"); Files.write(resolver.toPath(), dns.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            String phase = arguments.getString("phase", "semantics");
            if (!Arrays.asList("semantics", "providers", "verify").contains(phase)) throw new IllegalArgumentException("Unknown phase");
            String lib = context.getApplicationInfo().nativeLibraryDir;
            ArrayList<String> command = new ArrayList<>(Arrays.asList(
                lib + "/libproot.so", "--kill-on-exit", "--link2symlink", "-0", "-r", root.toString(),
                "-b", "/dev", "-b", "/proc", "-b", "/sys", "-b", resolver + ":/etc/resolv.conf",
                "-b", state + ":/home/host", "-b", workspace + ":/workspace", "-w", "/workspace",
                "/usr/bin/env", "-i", "HOME=/home/host", "LANG=C.UTF-8", "PATH=/opt/codex/bin:/usr/bin:/bin",
                "/usr/bin/python3", "/home/host/probe.py", phase));
            pidFile = new File(context.getCacheDir(), "probe-group.pid");
            ArrayList<String> grouped = new ArrayList<>(Arrays.asList("/system/bin/setsid", "/system/bin/sh", "-c",
                "printf '%s' \"$$\" > \"$1\"; shift; exec \"$@\"", "workspace-probe", pidFile.toString()));
            grouped.addAll(command);
            ProcessBuilder builder = new ProcessBuilder(grouped); builder.environment().clear();
            builder.environment().put("PROOT_LOADER", lib + "/libproot-loader.so");
            builder.environment().put("PROOT_TMP_DIR", tmp.toString()); builder.environment().put("LD_LIBRARY_PATH", lib);
            builder.redirectErrorStream(true); builder.redirectOutput(new File(state, "probe-" + phase + ".log"));
            process = builder.start(); process.getOutputStream().close();
            boolean ended = process.waitFor(420, TimeUnit.SECONDS);
            if (!ended || process.exitValue() != 0) throw new IllegalStateException("Guest probe failed; inspect private log");
            result.putString("stream", "WORKSPACE_PASS " + phase + "\n"); code = -1;
        } catch (Exception error) {
            result.putString("stream", "WORKSPACE_REFUSED " + error.getClass().getSimpleName() + ": " + error.getMessage() + "\n");
        } finally {
            try {
                if (pidFile != null && pidFile.isFile()) {
                    int group = Integer.parseInt(read(pidFile).trim());
                    if (group > 1) Os.kill(-group, OsConstants.SIGKILL);
                }
            } catch (Exception ignored) { }
            if (process != null && process.isAlive()) process.destroyForcibly();
        }
        finish(code, result);
    }
}
