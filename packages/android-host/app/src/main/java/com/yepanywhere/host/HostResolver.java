package com.yepanywhere.host;

import android.content.Context;
import android.net.*;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** musl cannot use Android's resolver. Mirror the active network's DNS only. */
final class HostResolver implements AutoCloseable {
    final File file;
    private final ConnectivityManager manager;
    private final Context context;
    private boolean closed;
    private final ConnectivityManager.NetworkCallback callback = new ConnectivityManager.NetworkCallback() {
        @Override public void onLinkPropertiesChanged(Network network, LinkProperties properties) { refresh(); }
        @Override public void onAvailable(Network network) { refresh(); }
        @Override public void onLost(Network network) { refresh(); }
    };

    HostResolver(Context context) throws IOException {
        this.context = context.getApplicationContext();
        file = new File(context.getCacheDir(), "host-resolv.conf");
        manager = context.getSystemService(ConnectivityManager.class);
        write();
        manager.registerDefaultNetworkCallback(callback);
    }

    private synchronized void refresh() {
        if (closed) return;
        try { write(); }
        catch (IOException error) { HostService.status(context, "DNS configuration could not update. Restart the local host."); }
    }

    private void write() throws IOException {
        Network active = manager.getActiveNetwork();
        LinkProperties properties = active == null ? null : manager.getLinkProperties(active);
        StringBuilder value = new StringBuilder("# Android active network; no public DNS fallback\n");
        if (properties != null) {
            for (java.net.InetAddress address : properties.getDnsServers()) {
                value.append("nameserver ").append(address.getHostAddress()).append('\n');
            }
        }
        // Preserve the inode: PRoot binds this file for the running guest.
        Files.write(file.toPath(), value.toString().getBytes(StandardCharsets.US_ASCII));
    }

    @Override public synchronized void close() {
        closed = true;
        manager.unregisterNetworkCallback(callback);
    }
}
