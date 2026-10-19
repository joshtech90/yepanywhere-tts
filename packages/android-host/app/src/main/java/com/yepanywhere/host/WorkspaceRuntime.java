package com.yepanywhere.host;

import android.content.*;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.CancellationSignal;
import android.system.Os;
import dev.machinecontrol.android.storage.LocalWorkspace;
import dev.machinecontrol.android.storage.SafDocuments;
import dev.machinecontrol.android.storage.SharedStorage;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Same-app-UID native document bridge, owned by the foreground host lifecycle. */
final class WorkspaceRuntime implements AutoCloseable {
    // This is a guest path. Android supplies the actual source through StorageManager.
    @android.annotation.SuppressLint("SdCardPath")
    static final String SHARED_PATH = "/sdcard";
    static final String VOLUME_PATH = "/storage";
    final Map<String, String> appliedVolumes = new LinkedHashMap<>();
    final Set<String> invalidVolumes = ConcurrentHashMap.newKeySet();
    private final BroadcastReceiver media;
    private final Runnable storageChanged;
    final String socket;
    final File sharedSource;
    private final File sharedPlaceholder;
    final Map<String, String> applied = new HashMap<>(); // At most 16 registry roots; fixed for this runtime.
    private final Map<String, File> sources = new LinkedHashMap<>();
    private final Context context;
    private final WorkspaceRegistry registry;
    private final LocalServerSocket server;
    private final Map<LocalSocket, CancellationSignal> clients = new ConcurrentHashMap<>(); // Bounded by four workers + four queued clients.
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(4));
    private final ScheduledThreadPoolExecutor deadlines = new ScheduledThreadPoolExecutor(1);
    private volatile boolean closed;
    static IntentFilter mediaFilter() {
        IntentFilter filter = new IntentFilter();
        for (String action : Arrays.asList(Intent.ACTION_MEDIA_MOUNTED, Intent.ACTION_MEDIA_UNMOUNTED, Intent.ACTION_MEDIA_EJECT,
                Intent.ACTION_MEDIA_REMOVED, Intent.ACTION_MEDIA_BAD_REMOVAL, Intent.ACTION_MEDIA_CHECKING, Intent.ACTION_MEDIA_UNMOUNTABLE)) filter.addAction(action);
        filter.addDataScheme("file"); return filter;
    }
    WorkspaceRuntime(Context context) throws Exception { this(context, () -> { }); }
    // mediaFilter contains only protected system broadcasts; lint cannot follow the helper.
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    WorkspaceRuntime(Context context, Runnable storageChanged) throws Exception {
        this.storageChanged = storageChanged;
        deadlines.setRemoveOnCancelPolicy(true);
        this.context = context.getApplicationContext(); registry = new WorkspaceRegistry(context); socket = context.getPackageName() + ".saf." + UUID.randomUUID();
        File primary = null;
        try { primary = SharedStorage.primary(context); }
        catch (IOException ignored) { /* Shared status reports current authority/availability. */ }
        sharedSource = primary;
        sharedPlaceholder = new File(context.getFilesDir(), "shared-storage-blocked");
        if (!sharedPlaceholder.isDirectory() && !sharedPlaceholder.mkdir()) throw new IOException("Cannot create blocked shared-storage placeholder");
        Os.chmod(sharedPlaceholder.toString(), 0000);
        JSONArray roots = registry.roots();
        File view = new File(context.getFilesDir(), "workspace-view"); view.mkdirs(); Os.chmod(view.toString(), 0700);
        File[] old = view.listFiles();
        if (old != null) for (File entry : old) { Os.chmod(entry.toString(), 0700); if (!entry.delete()) throw new IOException("Cannot refresh workspace placeholders"); }
        for (int i = 0; i < roots.length(); i++) {
            JSONObject root = roots.getJSONObject(i); String name = root.getString("name"); WorkspaceRegistry.name(name);
            File placeholder = new File(view, name); if (!placeholder.mkdir()) throw new IOException("Cannot create blocked workspace placeholder");
            Os.chmod(placeholder.toString(), 0000);
            if (root.getBoolean("direct")) try {
                File source = LocalWorkspace.resolve(context, android.net.Uri.parse(root.getString("tree")));
                sources.put(name, source); applied.put(name, root.getString("tree"));
            } catch (Exception ignored) { /* Per-root status explains refusal; other roots and private host remain usable. */ }
        }
        Os.chmod(view.toString(), 0555);
        File volumes = new File(context.getFilesDir(), "volume-view"); volumes.mkdirs(); Os.chmod(volumes.toString(), 0700);
        File[] previous = volumes.listFiles();
        if (previous != null) for (File entry : previous) { Os.chmod(entry.toString(), 0700); if (!entry.delete()) throw new IOException("Cannot refresh volume placeholders"); }
        for (SharedStorage.Volume volume : SharedStorage.removableVolumes(context)) {
            if (!SharedStorage.validVolumeId(volume.id)) continue;
            File placeholder = new File(volumes, volume.id);
            if (!placeholder.exists() && !placeholder.mkdir()) throw new IOException("Cannot create blocked volume placeholder");
            Os.chmod(placeholder.toString(), 0000);
            if (volume.reason == null) appliedVolumes.put(volume.id, volume.directory.toString());
        }
        Os.chmod(volumes.toString(), 0555);
        server = new LocalServerSocket(socket);
        java.nio.file.Files.write(new File(HostService.state(context), "android-saf-socket").toPath(), socket.getBytes(StandardCharsets.UTF_8));
        media = new BroadcastReceiver() {
            @Override public void onReceive(Context ignored, Intent event) {
                mediaChanged(event);
            }
        };
        // These are protected system broadcasts, including on API 33+.
        this.context.registerReceiver(media, mediaFilter());
        Thread accept = new Thread(() -> {
            while (!closed) {
                LocalSocket client = null;
                try {
                    client = server.accept();
                    if (client.getPeerCredentials().getUid() != android.os.Process.myUid()) { client.close(); continue; }
                    client.setSoTimeout(30000); clients.put(client, new CancellationSignal()); LocalSocket owned = client;
                    workers.execute(() -> serve(owned));
                } catch (Exception error) {
                    if (client != null) { clients.remove(client); try { client.close(); } catch (IOException ignored) { } }
                }
            }
        }, "ya-saf-accept"); accept.start();
    }
    static JSONObject sharedStatus(Context context, String applied) throws Exception {
        JSONObject status = new JSONObject().put("path", SHARED_PATH).put("available", false).put("mapped", false);
        try {
            File source = SharedStorage.primary(context);
            status.put("available", true).put("source", source.toString()).put("mapped", source.toString().equals(applied));
        } catch (IOException error) { status.put("reason", error.getMessage()); }
        return status;
    }
    void mediaChanged(Intent event) {
        // Bindings are fixed for this runtime; reinsertion must not silently retarget.
        String path = event.getData() == null ? null : event.getData().getPath();
        if (path != null) appliedVolumes.forEach((id, source) -> {
            if (source.equals(path) || id.equalsIgnoreCase(new File(path).getName())) invalidVolumes.add(id);
        });
        storageChanged.run();
    }

    static JSONArray volumeStatus(Context context, Map<String, String> applied, Set<String> invalidated) throws Exception {
        JSONArray result = new JSONArray(); Set<String> seen = new HashSet<>();
        for (SharedStorage.Volume volume : SharedStorage.removableVolumes(context)) {
            String id = volume.id; if (id != null) seen.add(id);
            boolean available = volume.reason == null, invalid = id != null && invalidated.contains(id);
            result.put(new JSONObject().put("id", id == null ? JSONObject.NULL : id).put("label", volume.label)
                .put("path", SharedStorage.validVolumeId(id) ? VOLUME_PATH + "/" + id : JSONObject.NULL)
                .put("available", available).put("mapped", available && !invalid && volume.directory.toString().equals(applied.get(id)))
                .put("source", available ? volume.directory.toString() : JSONObject.NULL)
                .put("reason", invalid && applied.containsKey(id) ? "Storage changed; restart host to apply mappings" : volume.reason));
        }
        for (String id : applied.keySet()) if (!seen.contains(id)) result.put(new JSONObject().put("id", id).put("label", "Removable storage")
            .put("path", VOLUME_PATH + "/" + id).put("available", false).put("mapped", false).put("reason", "Volume removed; insert it and restart host"));
        return result;
    }
    void bind(List<String> command) {
        command.addAll(Arrays.asList("-b", (sharedSource == null ? sharedPlaceholder : sharedSource) + ":" + SHARED_PATH + "!"));
        command.addAll(Arrays.asList("-b", new File(context.getFilesDir(), "volume-view") + ":" + VOLUME_PATH + "!"));
        appliedVolumes.forEach((id, source) -> command.addAll(Arrays.asList("-b", source + ":" + VOLUME_PATH + "/" + id + "!")));
        command.addAll(Arrays.asList("-b", new File(context.getFilesDir(), "workspace-view") + ":/workspaces"));
        // PRoot consumes a final ! as its no-dereference marker. Append that
        // marker explicitly so a folder whose actual name ends in ! stays intact.
        sources.forEach((name, file) -> command.addAll(Arrays.asList("-b", file + ":/workspaces/" + name + "!")));
    }
    private JSONObject dispatch(JSONObject request, CancellationSignal cancel, File transfer) throws Exception {
        String operation = request.getString("op");
        if (operation.equals("roots")) return new JSONObject().put("roots", registry.status(cancel, applied))
            .put("volumes", volumeStatus(context, appliedVolumes, invalidVolumes)).put("sharedStorage", sharedStatus(context, sharedSource == null ? null : sharedSource.toString())).put("maxBytes", SafDocuments.MAX_BYTES);
        if (operation.equals("check-shared")) {
            File actual = SharedStorage.primary(context);
            if (!actual.equals(sharedSource)) throw new IOException("Shared storage mapping changed; restart host to apply it");
            return new JSONObject().put("path", SHARED_PATH);
        }
        if (operation.equals("check-volume")) {
            String id = request.getString("volume");
            File actual = SharedStorage.removable(context, id);
            if (invalidVolumes.contains(id) || !actual.toString().equals(appliedVolumes.get(id))) throw new IOException("Removable mappings changed; restart host to apply them");
            return new JSONObject().put("path", VOLUME_PATH + "/" + id);
        }
        String name = request.getString("root"); JSONObject root = registry.root(name);
        android.net.Uri tree = android.net.Uri.parse(root.getString("tree"));
        if (operation.equals("check")) {
            if (!root.getBoolean("direct") || !tree.toString().equals(applied.get(name))) throw new IOException("Folder mapping changed; restart host to apply it");
            File actual = LocalWorkspace.resolve(context, tree);
            if (!actual.equals(sources.get(name))) throw new IOException("Folder identity changed; reselect and restart host");
            return new JSONObject().put("path", "/workspaces/" + name);
        }
        SafDocuments docs = new SafDocuments(context, tree, cancel); String path = request.optString("path", "");
        switch (operation) {
            case "ls": return docs.list(path);
            case "stat": return docs.stat(path);
            case "mkdir": return docs.mkdir(path);
            case "rm": return docs.remove(path, request.optBoolean("recursive", false));
            case "rename": return docs.rename(path, request.getString("name"));
            case "get":
                try (OutputStream output = new FileOutputStream(transfer)) { return new JSONObject().put("bytes", docs.read(path, output)); }
            case "put": return docs.write(path, transfer, request.optBoolean("replace", false));
            default: throw new IOException("Unknown document operation");
        }
    }
    private void serve(LocalSocket client) {
        CancellationSignal cancel = clients.get(client); File transfer = null;
        ScheduledFuture<?> timeout = deadlines.schedule(() -> {
            cancel.cancel(); try { client.close(); } catch (IOException ignored) { }
        }, 30, TimeUnit.SECONDS);
        try (LocalSocket owned = client) {
            DataInputStream input = new DataInputStream(client.getInputStream());
            DataOutputStream output = new DataOutputStream(client.getOutputStream());
            int size = input.readInt(); if (size < 2 || size > 16384) throw new IOException("Invalid request size");
            byte[] header = new byte[size]; input.readFully(header);
            JSONObject request = new JSONObject(new String(header, StandardCharsets.UTF_8));
            transfer = File.createTempFile("saf-transfer-", ".tmp", context.getCacheDir());
            if (request.getString("op").equals("put")) {
                long bytes = request.getLong("bytes");
                if (bytes < 0 || bytes > SafDocuments.MAX_BYTES) throw new IOException("Transfer exceeds 64 MiB limit");
                try (OutputStream file = new FileOutputStream(transfer)) {
                    byte[] buffer = new byte[65536]; long remaining = bytes;
                    while (remaining > 0) {
                        cancel.throwIfCanceled(); int n = input.read(buffer, 0, (int)Math.min(buffer.length, remaining));
                        if (n < 0) throw new EOFException("Upload incomplete; external document untouched");
                        file.write(buffer, 0, n); remaining -= n;
                    }
                    // Upload must end before the provider is allowed to mutate anything.
                    if (input.read() != -1) throw new IOException("Unexpected upload bytes");
                }
            }
            JSONObject result;
            try { result = new JSONObject().put("ok", true).put("result", dispatch(request, cancel, transfer)); }
            catch (Exception error) { result = failure(error); }
            byte[] reply = result.toString().getBytes(StandardCharsets.UTF_8);
            output.writeInt(reply.length); output.write(reply); output.flush();
            if (result.getBoolean("ok") && request.getString("op").equals("get"))
                try (InputStream file = new FileInputStream(transfer)) { SafDocuments.copy(file, output, SafDocuments.MAX_BYTES, cancel); }
        } catch (Exception error) {
            // A disconnected/timed-out client sees failure, never a success response.
        } finally {
            timeout.cancel(false); cancel.cancel(); if (transfer != null) transfer.delete(); clients.remove(client);
        }
    }
    private static JSONObject failure(Exception error) throws JSONException {
        return new JSONObject().put("ok", false).put("error", error.getClass().getSimpleName()).put("message", String.valueOf(error.getMessage()));
    }
    @Override public void close() {
        closed = true; context.unregisterReceiver(media);
        try { server.close(); } catch (IOException ignored) { }
        clients.forEach((client, cancel) -> { cancel.cancel(); try { client.close(); } catch (IOException ignored) { } });
        workers.shutdownNow(); deadlines.shutdownNow();
    }
}
