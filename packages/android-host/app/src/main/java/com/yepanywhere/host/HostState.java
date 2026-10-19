package com.yepanywhere.host;

import android.content.*;
import android.database.ContentObserver;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import java.util.*;

/** Main-process authority. Reading/observing this provider never starts a runtime. */
public final class HostState extends ContentProvider {
    private static Bundle current = snapshot("stopped", "Local host stopped", "", Collections.emptyMap(), null);
    static Uri uri(Context context) { return Uri.parse("content://" + context.getPackageName() + ".host-state"); }
    static Bundle snapshot(String phase, String detail, String generation, Map<String, String> mappings, String shared) {
        Bundle value = new Bundle(); value.putString("phase", phase); value.putString("detail", detail); value.putString("generation", generation);
        Bundle roots = new Bundle(); mappings.forEach(roots::putString); value.putBundle("mappings", roots); value.putString("shared", shared);
        return value;
    }
    static synchronized void publish(Context context, Bundle value) {
        current = new Bundle(value); context.getContentResolver().notifyChange(uri(context), null);
    }
    static Bundle read(Context context) {
        Bundle value = context.getContentResolver().call(uri(context), "snapshot", null, null);
        return value == null ? snapshot("stopped", "Host status unavailable", "", Collections.emptyMap(), null) : value;
    }
    static Map<String, String> mappings(Bundle snapshot) {
        return mappings(snapshot, "mappings");
    }
    static Map<String, String> mappings(Bundle snapshot, String key) {
        Map<String, String> roots = new HashMap<>(); Bundle values = snapshot.getBundle(key);
        if (values != null) for (String name : values.keySet()) roots.put(name, values.getString(name));
        return roots;
    }
    static Set<String> invalidVolumes(Bundle snapshot) {
        ArrayList<String> values = snapshot.getStringArrayList("invalidVolumes");
        return values == null ? Collections.emptySet() : new HashSet<>(values);
    }
    static boolean active(Bundle value) { return "starting".equals(value.getString("phase")) || "ready".equals(value.getString("phase")); }
    static final class Watch implements AutoCloseable {
        private final Context context;
        private final ContentObserver observer;
        Watch(Context context, Runnable refresh) {
            this.context = context;
            observer = new ContentObserver(new Handler(Looper.getMainLooper())) {
                @Override public void onChange(boolean self) { refresh.run(); }
            };
            context.getContentResolver().registerContentObserver(uri(context), false, observer);
        }
        @Override public void close() { context.getContentResolver().unregisterContentObserver(observer); }
    }
    @Override public boolean onCreate() { return true; }
    @Override public synchronized Bundle call(String method, String arg, Bundle extras) {
        if (!"snapshot".equals(method)) throw new IllegalArgumentException("Unknown host-state operation");
        synchronized (HostState.class) { return new Bundle(current); }
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) { throw new UnsupportedOperationException(); }
    @Override public String getType(Uri uri) { return "vnd.android.cursor.item/vnd.yepanywhere.host-state"; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
