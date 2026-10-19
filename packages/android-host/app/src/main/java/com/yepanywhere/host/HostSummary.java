package com.yepanywhere.host;

import android.os.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.function.Consumer;
import org.json.JSONObject;

/** One service-owned count-only stream; reconnects never inspect transcript files. */
final class HostSummary implements AutoCloseable {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile HttpURLConnection connection;
    private volatile boolean closed;
    HostSummary(String token, Consumer<JSONObject> changed) {
        worker.execute(() -> {
            int backoff = 1;
            while (!closed && !Thread.currentThread().isInterrupted()) {
                try {
                    HttpURLConnection active = HostConnection.open("/api/android-host/summary", token, 25000); connection = active;
                    if (closed) { active.disconnect(); break; }
                    if (active.getResponseCode() != 200) throw new IOException("Host summary unavailable");
                    try (BufferedReader input = new BufferedReader(new InputStreamReader(active.getInputStream(), StandardCharsets.UTF_8))) {
                        String line;
                        while (!closed && (line = input.readLine()) != null) {
                            if (line.length() > 1024) throw new IOException("Invalid host summary");
                            if (line.startsWith("data: ")) {
                                JSONObject summary = new JSONObject(line.substring(6));
                                int working = summary.getInt("working"), attention = summary.getInt("attention");
                                if (working < 0 || attention < 0) throw new IOException("Invalid session counts");
                                backoff = 1;
                                main.post(() -> { if (!closed) changed.accept(summary); });
                            }
                        }
                    }
                } catch (Exception unavailable) { /* Status below explicitly drops stale counts. */ }
                finally { HttpURLConnection active = connection; connection = null; if (active != null) active.disconnect(); }
                main.post(() -> { if (!closed) changed.accept(null); });
                try { Thread.sleep(backoff * 1000L); }
                catch (InterruptedException stopped) { Thread.currentThread().interrupt(); break; }
                backoff = Math.min(30, backoff * 2);
            }
        });
    }
    @Override public void close() {
        closed = true; worker.shutdownNow(); main.removeCallbacksAndMessages(null);
        HttpURLConnection active = connection;
        // disconnect can block while Android's HTTP implementation closes a read.
        if (active != null) new Thread(active::disconnect, "ya-summary-close").start();
    }
}
