package com.yepanywhere.host;

import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** A saved credential or status file is not evidence of a live local server. */
final class HostConnection {
    static final int PORT = BuildConfig.HOST_PORT;
    static final String ORIGIN = "http://127.0.0.1:" + PORT;
    private HostConnection() { }

    static HttpURLConnection open(String path, String token, int timeout) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(ORIGIN + path).openConnection();
        connection.setConnectTimeout(1000); connection.setReadTimeout(timeout);
        connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
        connection.setRequestProperty("X-Desktop-Token", token);
        return connection;
    }
    static String token(File home) throws Exception {
        String token = new String(Files.readAllBytes(new File(home, ".local-access-token").toPath()), StandardCharsets.UTF_8).trim();
        if (!token.matches("[A-Za-z0-9_-]{43}")) throw new IllegalStateException("Invalid local credential");
        return token;
    }

    // Call only off the main thread. Return the current credential only after
    // the server accepts it. This endpoint is a cheap fixed disabled response
    // under the Android profile; it never samples workstation processes.
    static String ready(android.content.Context context) {
        HttpURLConnection connection = null;
        try {
            android.os.Bundle state = HostState.read(context);
            if (!HostState.active(state) || !state.getBoolean("spawned")) return null;
            String token = token(HostService.state(context));
            connection = open("/api/host-agent-processes", token, 1000);
            return connection.getResponseCode() == 200 ? token : null;
        } catch (Exception unavailable) { return null; }
        finally { if (connection != null) connection.disconnect(); }
    }
}
