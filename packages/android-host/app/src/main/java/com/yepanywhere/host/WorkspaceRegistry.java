package com.yepanywhere.host;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.CancellationSignal;
import android.util.AtomicFile;
import dev.machinecontrol.android.storage.LocalWorkspace;
import dev.machinecontrol.android.storage.SafDocuments;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** Product registrations, not permission authority. Files remain outside app data. */
final class WorkspaceRegistry {
    private static final Object LOCK = new Object();
    private final Context context;
    private final AtomicFile file;
    WorkspaceRegistry(Context context) {
        this.context = context.getApplicationContext();
        file = new AtomicFile(new File(context.getFilesDir(), "workspaces.json"));
    }
    static void name(String value) throws IOException {
        if (value == null || value.isEmpty() || value.length() > 48 || value.equals(".") || value.equals(".."))
            throw new IOException("Use a folder name of 1–48 characters, excluding . and ..");
        for (int i = 0; i < value.length(); i++) if ("/\\:".indexOf(value.charAt(i)) >= 0 || Character.isISOControl(value.charAt(i)))
            throw new IOException("Folder names cannot contain slashes, colons or control characters");
    }
    private static String shorten(String value, int limit) {
        if (value.length() <= limit) return value;
        if (Character.isHighSurrogate(value.charAt(limit - 1))) limit--;
        return value.substring(0, limit);
    }
    String add(Uri tree, CancellationSignal cancel) throws Exception {
        String display = new SafDocuments(context, tree, cancel).stat("").getString("name");
        StringBuilder clean = new StringBuilder();
        for (int i = 0; i < display.length(); i++) {
            char c = display.charAt(i); clean.append("/\\:".indexOf(c) >= 0 || Character.isISOControl(c) ? '-' : c);
        }
        String base = clean.toString().trim();
        if (base.isEmpty() || base.equals(".") || base.equals("..")) base = "folder";
        base = shorten(base, 48);
        synchronized (LOCK) {
            JSONArray roots = roots(); Set<String> used = new HashSet<>();
            for (int i = 0; i < roots.length(); i++) used.add(roots.getJSONObject(i).getString("name"));
            String available = base;
            for (int suffix = 1; used.contains(available); suffix++) {
                String ending = "-" + suffix; available = shorten(base, 48 - ending.length()) + ending;
            }
            select(available, tree); return available;
        }
    }
    JSONArray roots() throws Exception {
        synchronized (LOCK) {
            if (!file.getBaseFile().exists()) return new JSONArray();
            try (InputStream input = file.openRead()) {
                ByteArrayOutputStream data = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096]; int n;
                while ((n = input.read(buffer)) != -1) {
                    data.write(buffer, 0, n); if (data.size() > 65536) throw new IOException("Folder registry exceeds limit");
                }
                byte[] bytes = data.toByteArray();
                if (bytes.length > 65536) throw new IOException("Folder registry exceeds limit");
                return new JSONArray(new String(bytes, StandardCharsets.UTF_8));
            }
        }
    }
    JSONObject root(String name) throws Exception {
        JSONArray roots = roots();
        for (int i = 0; i < roots.length(); i++) if (name.equals(roots.getJSONObject(i).getString("name"))) return roots.getJSONObject(i);
        throw new IOException("Unknown folder shortcut: " + name);
    }
    private void save(JSONArray roots) throws Exception {
        FileOutputStream output = file.startWrite();
        try { output.write(roots.toString().getBytes(StandardCharsets.UTF_8)); file.finishWrite(output); }
        catch (Exception error) { file.failWrite(output); throw error; }
    }
    void select(String name, Uri tree) throws Exception {
        name(name);
        String previous = null;
        synchronized (LOCK) {
            JSONArray roots = roots(); JSONObject existing = null;
            for (int i = 0; i < roots.length(); i++) {
                JSONObject root = roots.getJSONObject(i);
                if (name.equals(root.getString("name"))) existing = root;
                else {
                    Uri other = Uri.parse(root.getString("tree"));
                    if (Objects.equals(other.getAuthority(), tree.getAuthority()) &&
                        android.provider.DocumentsContract.getTreeDocumentId(other).equals(android.provider.DocumentsContract.getTreeDocumentId(tree)))
                        throw new IOException("Folder already registered as " + root.getString("name"));
                }
            }
            if (existing == null) {
                if (roots.length() >= 16) throw new IOException("At most 16 folder shortcuts are supported");
                existing = new JSONObject().put("id", UUID.randomUUID().toString()).put("name", name).put("direct", false); roots.put(existing);
            } else previous = existing.optString("tree", null);
            existing.put("tree", tree.toString()); save(roots);
        }
        if (previous != null && !previous.equals(tree.toString())) releaseUnused(previous);
    }
    void change(String old, String renamed, Boolean direct) throws Exception {
        name(renamed);
        synchronized (LOCK) {
            JSONArray roots = roots(); JSONObject found = null;
            for (int i = 0; i < roots.length(); i++) {
                JSONObject row = roots.getJSONObject(i);
                if (old.equals(row.getString("name"))) found = row;
                else if (renamed.equals(row.getString("name"))) throw new IOException("Shortcut name already exists");
            }
            if (found == null) throw new IOException("Shortcut no longer exists");
            found.put("name", renamed); if (direct != null) found.put("direct", direct); save(roots);
        }
    }
    void remove(String name) throws Exception {
        String uri = null;
        synchronized (LOCK) {
            JSONArray roots = roots(), kept = new JSONArray();
            for (int i = 0; i < roots.length(); i++) {
                JSONObject row = roots.getJSONObject(i);
                if (name.equals(row.getString("name"))) uri = row.getString("tree"); else kept.put(row);
            }
            if (uri == null) throw new IOException("Shortcut no longer exists");
            save(kept);
        }
        releaseUnused(uri);
    }
    private void releaseUnused(String uri) throws Exception {
        synchronized (LOCK) {
            JSONArray roots = roots();
            for (int i = 0; i < roots.length(); i++) if (uri.equals(roots.getJSONObject(i).getString("tree"))) return;
            try { context.getContentResolver().releasePersistableUriPermission(Uri.parse(uri),
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); }
            catch (SecurityException ignored) { /* Already revoked. Registration removal still succeeds. */ }
        }
    }
    JSONArray status(CancellationSignal cancel, Map<String, String> applied) throws Exception {
        JSONArray roots = roots(), result = new JSONArray();
        for (int i = 0; i < roots.length(); i++) {
            JSONObject row = roots.getJSONObject(i); Uri tree = Uri.parse(row.getString("tree"));
            JSONObject status = new JSONObject(row.toString()).put("path", "/workspaces/" + row.getString("name"));
            try {
                new SafDocuments(context, tree, cancel).stat(""); status.put("safAvailable", true);
            } catch (Exception error) { status.put("safAvailable", false).put("safReason", error.getMessage()); }
            try {
                if (!row.getBoolean("direct")) throw new IOException("Direct access disabled for this shortcut");
                File root = LocalWorkspace.resolve(context, tree);
                status.put("directAvailable", true).put("source", root.toString());
            } catch (Exception error) { status.put("directAvailable", false).put("directReason", error.getMessage()); }
            status.put("mapped", applied != null && tree.toString().equals(applied.get(row.getString("name"))) && status.getBoolean("directAvailable"));
            JSONArray overlap = new JSONArray();
            for (int j = 0; j < roots.length(); j++) if (i != j) {
                JSONObject other = roots.getJSONObject(j); Uri otherTree = Uri.parse(other.getString("tree"));
                if (Objects.equals(tree.getAuthority(), otherTree.getAuthority())) {
                    String a = android.provider.DocumentsContract.getTreeDocumentId(tree), b = android.provider.DocumentsContract.getTreeDocumentId(otherTree);
                    if (a.startsWith(b + "/") || b.startsWith(a + "/")) overlap.put(other.getString("name"));
                }
            }
            status.put("overlaps", overlap); result.put(status);
        }
        return result;
    }
}
