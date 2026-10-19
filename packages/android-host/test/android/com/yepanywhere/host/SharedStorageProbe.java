package com.yepanywhere.host;

import android.app.Instrumentation;
import android.os.*;
import android.os.storage.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import org.json.*;

/** Fixture-only native inventory and production PRoot binding exercise. */
public final class SharedStorageProbe extends Instrumentation {
    private Bundle arguments;
    @Override public void onCreate(Bundle args) { arguments = args; start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            android.content.Context context = getTargetContext();
            JSONObject facts = new JSONObject().put("allFiles", Environment.isExternalStorageManager())
                .put("persistedGrants", context.getContentResolver().getPersistedUriPermissions().size());
            JSONArray volumes = new JSONArray(); String removableId = null;
            for (StorageVolume volume : context.getSystemService(StorageManager.class).getStorageVolumes()) {
                File directory = volume.getDirectory();
                volumes.put(new JSONObject().put("primary", volume.isPrimary()).put("removable", volume.isRemovable())
                    .put("emulated", volume.isEmulated()).put("state", volume.getState()).put("uuid", volume.getUuid())
                    .put("directory", directory == null ? JSONObject.NULL : directory.getCanonicalPath()));
                if (volume.isRemovable() && Environment.MEDIA_MOUNTED.equals(volume.getState()) && directory != null) {
                    if (removableId != null) throw new IOException("Select exactly one removable test volume");
                    removableId = volume.getUuid();
                }
            }
            facts.put("volumes", volumes);
            if ("probe".equals(arguments.getString("op")) || "transition".equals(arguments.getString("op"))) {
                String run = arguments.getString("run", "");
                if (!run.matches("[a-f0-9]{32}")) throw new IOException("An owned run identifier is required");
                HostService.state(context).mkdirs();
                try (WorkspaceRuntime runtime = new WorkspaceRuntime(context)) {
                    String lib = context.getApplicationInfo().nativeLibraryDir;
                    File root = new File(context.getFilesDir(), "runtime");
                    List<String> command = new ArrayList<>(Arrays.asList(lib + "/libproot.so", "--kill-on-exit", "-i", "1000:1000",
                        "-r", root.toString(), "-b", "/dev", "-b", "/proc", "-b", "/sys",
                        "-b", new File(context.getFilesDir(), "storage-probe.py") + ":/storage-probe.py!"));
                    runtime.bind(command);
                    File control = new File(context.getCacheDir(), "missing-volume-probe"); control.mkdirs();
                    File source = new File(control, "source"), detached = new File(control, "detached");
                    if (detached.exists() && !detached.delete()) throw new IOException("Cannot reset owned disappearance probe");
                    if (!source.exists() && !source.mkdir()) throw new IOException("Cannot create owned disappearance probe");
                    command.addAll(Arrays.asList("-b", control + ":/control!", "-b", source + ":/storage/fixture-missing!"));
                    boolean external = Boolean.parseBoolean(arguments.getString("external", "false"));
                    if (external && removableId == null) throw new IOException("Mounted removable volume required");
                    command.addAll(Arrays.asList("-w", "/", "/usr/bin/python3", "/storage-probe.py"));
                    ProcessBuilder builder = new ProcessBuilder(command); builder.directory(context.getFilesDir());
                    Map<String, String> env = builder.environment(); env.clear();
                    env.put("PROOT_LOADER", lib + "/libproot-loader.so"); env.put("PROOT_TMP_DIR", context.getCacheDir().toString());
                    env.put("LD_LIBRARY_PATH", lib); env.put("YEP_ANDROID_SAF_SOCKET", runtime.socket);
                    env.put("PATH", "/usr/bin:/bin"); env.put("YA_STORAGE_RUN", run);
                    env.put("YA_STORAGE_ALLOWED", String.valueOf(Environment.isExternalStorageManager()));
                    env.put("YA_STORAGE_EXTERNAL_PATH", external ? "/storage/" + removableId : "");
                    builder.redirectError(new File(context.getFilesDir(), "storage-probe-error.log"));
                    facts.put("probe", executeProbe(builder));
                    if ("transition".equals(arguments.getString("op"))) {
                        runtime.mediaChanged(new android.content.Intent(android.content.Intent.ACTION_MEDIA_UNMOUNTED)
                            .setData(android.net.Uri.fromFile(new File("/storage/unrelated-fixture-volume"))));
                        if (!runtime.invalidVolumes.isEmpty()) throw new IOException("Unrelated media event invalidated a healthy volume");
                        runtime.mediaChanged(new android.content.Intent(android.content.Intent.ACTION_MEDIA_UNMOUNTED)
                            .setData(android.net.Uri.fromFile(new File("/mnt/media_rw/" + removableId.toLowerCase(Locale.ROOT)))));
                        builder.environment().put("YA_STORAGE_INVALIDATED", "true");
                        builder.environment().put("YA_STORAGE_DISAPPEAR", "true");
                        facts.put("transition", executeProbe(builder));
                    }
                }
            }
            Files.write(new File(context.getFilesDir(), "storage-probe.json").toPath(), facts.toString().getBytes(StandardCharsets.UTF_8));
            result.putString("stream", "SHARED_STORAGE_PASS\n");
        } catch (Exception error) { result.putString("stream", "SHARED_STORAGE_FAILED " + error + "\n"); }
        finish(result.getString("stream", "").contains("SHARED_STORAGE_PASS") ? -1 : 1, result);
    }
    private static JSONObject executeProbe(ProcessBuilder builder) throws Exception {
        java.lang.Process process = builder.start();
        if (!process.waitFor(45, java.util.concurrent.TimeUnit.SECONDS)) { process.destroyForcibly(); throw new IOException("Storage probe timed out"); }
        byte[] output;
        try (InputStream input = process.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) {
                bytes.write(buffer, 0, count);
                if (bytes.size() > 16384) throw new IOException("Storage probe output exceeds limit");
            }
            output = bytes.toByteArray();
        }
        if (process.exitValue() != 0) throw new IOException("Guest storage probe failed; private error log retained");
        return new JSONObject(new String(output, StandardCharsets.UTF_8));
    }

}
