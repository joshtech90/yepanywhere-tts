package com.yepanywhere.host;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.*;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.*;
import java.io.File;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Same YA frontend, authenticated with the existing desktop-token mechanism. */
public final class LocalWebActivity extends Activity {
    // Match the companion: one mounted document, bounded in-memory histories,
    // and token-free navigation metadata on disk. Inactive tabs own no JS.
    private static final int MAX_TABS = 32;
    private static final class Tab {
        final String id;
        Uri route;
        Bundle history;
        String token;
        String title;
        Tab(String id, String path) { this.id = id; route = Uri.parse(HostConnection.ORIGIN + safePath(path)); }
    }
    private final java.util.ArrayList<Tab> tabs = new java.util.ArrayList<>();
    private Tab selected;
    private FrameLayout page;
    private TextView title;
    private Button tabButton;
    private Button addButton;
    private boolean activityResumed;
    private WebView web;
    private WebView popup;
    private LinearLayout recovery;
    private TextView message;
    private ProgressBar progress;
    private Button retry;
    private final Handler handler = new Handler(Looper.getMainLooper());
    // One active probe and at most one newer request; cancelled generations
    // cannot accumulate an unbounded queue during rapid lifecycle changes.
    private final ThreadPoolExecutor probes = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(1), new ThreadPoolExecutor.DiscardOldestPolicy());
    private Future<?> pending;
    private int generation;
    private int navigation;
    private int verification;
    private boolean resumed, pageLoaded;
    private String lastToken;
    private Uri lastRoute;
    private Uri mainNavigation;
    private void trace(String event) {
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
            android.util.Log.d("YAHostWeb", event);
    }

    private boolean current(int attempt) { return resumed && generation == attempt; }
    private void showConnecting() {
        recovery.setVisibility(View.VISIBLE); web.setVisibility(View.GONE);
        if (pageLoaded) unload();
        message.setText(R.string.host_connecting); progress.setVisibility(View.VISIBLE);
        retry.setVisibility(View.GONE);
    }
    private void failed(int label) {
        generation++;
        if (pending != null) pending.cancel(true);
        recovery.setVisibility(View.VISIBLE); web.setVisibility(View.GONE);
        unload();
        message.setText(label); progress.setVisibility(View.GONE); retry.setVisibility(View.VISIBLE);
    }
    private boolean local(Uri uri) {
        return "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && uri.getPort() == HostConnection.PORT;
    }
    private void unload() {
        if (pageLoaded && web.getUrl() != null && local(Uri.parse(web.getUrl()))) lastRoute = Uri.parse(web.getUrl());
        pageLoaded = false;
        if (selected != null) selected.history = null;
        mainNavigation = null;
        // A hidden failed page must not keep its JS subscriptions/retries alive.
        web.stopLoading(); web.loadUrl("about:blank");
    }
    private void navigating(Uri uri) {
        if (pageLoaded && web.getUrl() != null && local(Uri.parse(web.getUrl()))) lastRoute = Uri.parse(web.getUrl());
        mainNavigation = uri.buildUpon().fragment(null).build(); pageLoaded = false; navigation++; generation++;
        if (pending != null) pending.cancel(true);
    }
    private boolean mainRequest(WebResourceRequest request) {
        // WebView reports the service worker's failed fetch of a navigation as
        // main=false. Match only our outstanding top-level URL, never arbitrary
        // failed images/API calls. Clear the marker on completion or unload.
        return request.isForMainFrame() || (mainNavigation != null &&
            mainNavigation.equals(request.getUrl().buildUpon().fragment(null).build()));
    }
    private void verifyNavigation(String url, boolean complete) {
        if (!resumed) return;
        // Duplicate page-finished callbacks can replace a probe without a new
        // navigation. A cancelled HTTP probe must not fail that newer check.
        int check = ++verification, attempt = generation, load = navigation;
        if (pending != null) pending.cancel(true);
        pending = probes.submit(() -> {
            String token = HostConnection.ready(this);
            handler.post(() -> {
                if (!current(attempt) || check != verification || navigation != load || web.getVisibility() != View.VISIBLE) return;
                if (token == null || !local(Uri.parse(url))) { failed(R.string.host_open_failed); return; }
                if (complete) {
                    pageLoaded = true; mainNavigation = null;
                    Uri route = Uri.parse(web.getUrl());
                    lastRoute = local(route) ? route : Uri.parse(url);
                    selected.route = lastRoute; persist();
                }
            });
        });
    }
    private void ready(String token, boolean reload) {
        recovery.setVisibility(View.GONE); web.setVisibility(View.VISIBLE);
        if (!pageLoaded || reload || !token.equals(lastToken)) {
            Uri uri = selected.route;
            if (!reload && selected.history != null && token.equals(selected.token)) {
                // WebView history does not restore in-memory page auth. Always
                // bootstrap the mounted document with the current credential
                // below, even when the saved URL no longer contains it.
                web.restoreState(selected.history);
            }
            selected.history = null;
            // Preserve the existing route/query when recovering a warm page.
            if (pageLoaded && web.getUrl() != null && local(Uri.parse(web.getUrl()))) uri = Uri.parse(web.getUrl());
            else if (lastRoute != null) uri = lastRoute;
            Uri.Builder target = uri.buildUpon().clearQuery();
            for (String key : uri.getQueryParameterNames()) {
                if (!"desktop_token".equals(key))
                    for (String value : uri.getQueryParameters(key)) target.appendQueryParameter(key, value);
            }
            lastToken = token;
            Uri destination = target.appendQueryParameter("desktop_token", token).build();
            navigating(destination); web.loadUrl(destination.toString());
        }
    }
    private void connect() {
        int attempt = ++generation;
        if (pending != null) pending.cancel(true);
        if (!new File(getFilesDir(), "runtime/opt/host/launch.mjs").isFile()) { failed(R.string.host_runtime_missing); return; }
        if (!pageLoaded) showConnecting();
        pending = probes.submit(() -> {
            String token = HostConnection.ready(this);
            handler.post(() -> {
                if (!current(attempt)) return;
                if (token != null) { ready(token, false); return; }
                showConnecting();
                // This is a visible user-open/retry, not boot or background
                // auto-restart. Service startup is idempotent in its process.
                try { HostService.command(this, HostService.START); }
                catch (RuntimeException denied) { failed(R.string.host_start_failed); return; }
                pending = probes.submit(() -> awaitReady(attempt));
            });
        });
    }
    private void awaitReady(int attempt) {
        long deadline = SystemClock.uptimeMillis() + 45000;
        while (!Thread.currentThread().isInterrupted() && SystemClock.uptimeMillis() < deadline) {
            String token = HostConnection.ready(this);
            if (token != null) {
                handler.post(() -> { if (current(attempt)) ready(token, true); }); return;
            }
            try { Thread.sleep(500); }
            catch (InterruptedException cancelled) { Thread.currentThread().interrupt(); return; }
        }
        handler.post(() -> { if (current(attempt)) failed(R.string.host_not_ready); });
    }
    private void openBrowser(Uri uri) {
        if (!"http".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(uri.getScheme())) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (android.content.ActivityNotFoundException error) {
            android.widget.Toast.makeText(this, R.string.browser_unavailable, android.widget.Toast.LENGTH_LONG).show();
        }
    }
    private void closePopup(WebView child) {
        if (popup == child) { popup = null; child.destroy(); }
    }
    @android.annotation.SuppressLint("SetJavaScriptEnabled") // Fixed authenticated loopback app; no privileged JS bridge.
    private void mountDocument() {
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setSupportMultipleWindows(true);
        web.setOnLongClickListener(view -> {
            String link = web.getHitTestResult().getExtra();
            int type = web.getHitTestResult().getType();
            if (link == null || (type != WebView.HitTestResult.SRC_ANCHOR_TYPE &&
                type != WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) || !local(Uri.parse(link))) return false;
            new android.app.AlertDialog.Builder(this).setItems(new String[] {getString(R.string.host_open_new_tab)},
                (dialog, which) -> newTab(Uri.parse(link))).show();
            return true;
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (view != web) return true;
                trace("navigate main=" + request.isForMainFrame());
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                if (local(uri)) {
                    Uri current = web.getUrl() == null ? null : Uri.parse(web.getUrl());
                    boolean fragmentOnly = pageLoaded && current != null &&
                        !java.util.Objects.equals(uri.getFragment(), current.getFragment()) &&
                        uri.buildUpon().fragment(null).build().equals(current.buildUpon().fragment(null).build());
                    if (!fragmentOnly) {
                        navigating(uri);
                        // A service-worker fetch failure can arrive before
                        // this top-level navigation callback. Verify here
                        // too, even if no page-start/finish event follows.
                        verifyNavigation(uri.toString(), false);
                    }
                    return false;
                }
                openBrowser(uri);
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (view != web) return;
                trace("start scheme=" + Uri.parse(url).getScheme() + " visible=" + web.getVisibility());
                if (local(Uri.parse(url))) {
                    navigating(Uri.parse(url));
                } else navigation++;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (view != web) return;
                trace("finish scheme=" + Uri.parse(url).getScheme() + " visible=" + web.getVisibility() + " same=" + url.equals(web.getUrl()));
                if (web.getVisibility() != View.VISIBLE || "about:blank".equals(url) || !url.equals(web.getUrl())) return;
                // A completed document load still needs a live backend.
                verifyNavigation(url, true);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (view != web) return;
                trace("error code=" + error.getErrorCode() + " main=" + request.isForMainFrame() + " visible=" + web.getVisibility());
                if (mainRequest(request) && web.getVisibility() == View.VISIBLE) failed(R.string.host_open_failed);
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (view != web) return;
                trace("http code=" + response.getStatusCode() + " main=" + request.isForMainFrame() + " visible=" + web.getVisibility());
                if (mainRequest(request) && web.getVisibility() == View.VISIBLE) failed(R.string.host_open_failed);
            }
        });
        // Ordinary links can use target=_blank. Android needs an explicit
        // window transport or the tap can silently do nothing.
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onReceivedTitle(WebView view, String value) {
                if (view != web || value == null || value.isBlank() || "about:blank".equals(value)) return;
                selected.title = value.substring(0, Math.min(value.length(), 160));
                title.setText("Yep Anywhere".equals(selected.title) ? safePath(selected.route.getPath()) : selected.title);
            }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, android.os.Message message) {
                if (!gesture || view != web) return false;
                if (popup != null) popup.destroy();
                popup = new WebView(LocalWebActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public WebResourceResponse shouldInterceptRequest(WebView child, WebResourceRequest request) {
                        return new WebResourceResponse("text/plain", "utf-8", new java.io.ByteArrayInputStream(new byte[0]));
                    }
                    @Override public boolean shouldOverrideUrlLoading(WebView child, WebResourceRequest request) {
                        Uri uri = request.getUrl();
                        if (request.isForMainFrame()) {
                            if (local(uri)) newTab(uri); else openBrowser(uri);
                        }
                        child.post(() -> closePopup(child));
                        return true;
                    }
                });
                ((WebView.WebViewTransport) message.obj).setWebView(popup);
                message.sendToTarget();
                WebView child = popup;
                web.postDelayed(() -> closePopup(child), 5000);
                return true;
            }
        });
        page.addView(web, 0, new FrameLayout.LayoutParams(-1, -1));
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private static String safePath(String value) {
        String path = value.split("[?#]", 2)[0];
        return path.startsWith("/") && !path.startsWith("//") && !path.contains("\\") &&
            path.length() <= 8192 && !path.matches("(?s).*[\\x00-\\x1f].*") &&
            !path.startsWith("/login") && !path.startsWith("/open") ? path : "/projects";
    }
    private void remember() {
        if (selected == null) return;
        if (pageLoaded && web.getUrl() != null && local(Uri.parse(web.getUrl()))) {
            lastRoute = Uri.parse(web.getUrl());
            selected.history = null;
            if (web.copyBackForwardList().getSize() <= 64) {
                Bundle history = new Bundle();
                if (web.saveState(history) != null) selected.history = history;
            }
            selected.token = lastToken;
        }
        if (lastRoute != null) selected.route = lastRoute;
    }
    private void persist() {
        org.json.JSONArray records = new org.json.JSONArray();
        try {
            for (Tab tab : tabs) records.put(new org.json.JSONObject().put("id", tab.id)
                .put("path", safePath(tab.route.getEncodedPath())));
            getSharedPreferences("native-tabs", MODE_PRIVATE).edit().putString("state",
                new org.json.JSONObject().put("selected", selected == null ? "" : selected.id)
                    .put("tabs", records).toString()).apply();
        } catch (org.json.JSONException ignored) { }
        tabButton.setText(getString(R.string.host_tabs_count, tabs.size()));
        if (addButton != null) { addButton.setEnabled(tabs.size() < MAX_TABS); addButton.setContentDescription(tabs.size() < MAX_TABS ? getString(R.string.host_new_tab) : "Tab limit reached: 32 tabs"); }
        title.setText(selected == null ? getString(R.string.host_web_title) :
            selected.title != null && !"Yep Anywhere".equals(selected.title) ? selected.title : safePath(selected.route.getPath()));
    }
    private void restore() {
        try {
            org.json.JSONObject state = new org.json.JSONObject(getSharedPreferences("native-tabs", MODE_PRIVATE).getString("state", "{}"));
            org.json.JSONArray records = state.optJSONArray("tabs");
            if (records != null) for (int i = 0; i < Math.min(records.length(), MAX_TABS); i++) {
                org.json.JSONObject record = records.getJSONObject(i);
                String id = record.getString("id");
                if (id.length() != 36 || tabs.stream().anyMatch(tab -> tab.id.equals(id))) continue;
                Tab tab = new Tab(id, record.optString("path", "/projects")); tabs.add(tab);
                if (id.equals(state.optString("selected"))) selected = tab;
            }
        } catch (org.json.JSONException ignored) { tabs.clear(); selected = null; }
        if (selected == null && !tabs.isEmpty()) selected = tabs.get(0);
    }
    private void activate(Tab next) {
        if (selected == next && web != null) return;
        remember();
        generation++; if (pending != null) pending.cancel(true);
        if (popup != null) closePopup(popup);
        if (web != null) {
            page.removeView(web); web.setWebViewClient(new WebViewClient()); web.setWebChromeClient(null);
            web.stopLoading(); web.destroy();
        }
        selected = next; pageLoaded = false; lastToken = null; mainNavigation = null;
        lastRoute = next.route; navigation++;
        mountDocument(); showConnecting(); persist();
        if (activityResumed) connect();
    }
    private void newTab(String path) { newTab(Uri.parse(HostConnection.ORIGIN + path)); }
    private void newTab(Uri route) {
        if (tabs.size() >= MAX_TABS) {
            Toast.makeText(this, getResources().getQuantityString(R.plurals.host_tab_limit, MAX_TABS, MAX_TABS), Toast.LENGTH_SHORT).show(); return;
        }
        Tab tab = new Tab(java.util.UUID.randomUUID().toString(), "/projects");
        tab.route = route; tabs.add(tab); activate(tab);
    }
    private void home() {
        remember(); persist();
        startActivity(new Intent(this, HostActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
    }
    private void showTabs() {
        remember(); persist();
        LinearLayout list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL);
        ScrollView scroll = new ScrollView(this); scroll.addView(list);
        android.app.AlertDialog dialog = new android.app.AlertDialog.Builder(this).setTitle(R.string.host_tabs)
            .setView(scroll).setNegativeButton(R.string.host_done, null)
            .setPositiveButton(R.string.host_new_tab, (value, which) -> newTab("/projects")).create();
        for (Tab tab : tabs) {
            LinearLayout row = new LinearLayout(this); row.setGravity(android.view.Gravity.CENTER_VERTICAL);
            Button label = new Button(this, null, android.R.attr.borderlessButtonStyle);
            label.setAllCaps(false); label.setGravity(android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL);
            label.setPadding(dp(16), dp(8), dp(8), dp(8)); label.setMinHeight(dp(64));
            String path = safePath(tab.route.getPath());
            String caption = tab.title == null || "Yep Anywhere".equals(tab.title) ? path :
                getString(R.string.host_tab_details, tab.title, path);
            label.setMaxLines(3); label.setEllipsize(android.text.TextUtils.TruncateAt.END);
            label.setText(getString(R.string.host_tab_label, tab == selected ? "✓ " : "", caption));
            label.setContentDescription(getString(R.string.host_select_tab, safePath(tab.route.getPath())));
            label.setOnClickListener(view -> { dialog.dismiss(); activate(tab); });
            row.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
            Button close = new Button(this, null, android.R.attr.borderlessButtonStyle); close.setText("×");
            close.setContentDescription(getString(R.string.host_close_tab, safePath(tab.route.getPath())));
            close.setOnClickListener(view -> {
                dialog.dismiss();
                int index = tabs.indexOf(tab); tabs.remove(tab);
                if (selected == tab) {
                    if (tabs.isEmpty()) {
                        // Replace the final tab before returning home, so a
                        // later Open still has a useful fresh destination.
                        newTab("/projects"); home();
                    } else activate(tabs.get(Math.min(index, tabs.size() - 1)));
                }
                persist();
            });
            row.addView(close, new LinearLayout.LayoutParams(dp(48), dp(48))); list.addView(row);
        }
        dialog.show();
        dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setEnabled(tabs.size() < MAX_TABS);
        if (tabs.size() >= MAX_TABS) dialog.setTitle("Tabs · 32-tab limit reached");
    }
    private void provider(Intent intent) {
        String provider = intent.getStringExtra("provider");
        if (!"codex".equals(provider) && !"claude".equals(provider)) return;
        String path = "/provider-sign-in/" + provider;
        intent.removeExtra("provider");
        for (Tab tab : tabs) if (path.equals(tab.route.getPath())) { activate(tab); return; }
        newTab(path);
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent); provider(intent);
    }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setDecorFitsSystemWindows(false);
        android.view.WindowManager.LayoutParams windowLayout = getWindow().getAttributes();
        windowLayout.layoutInDisplayCutoutMode = android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        getWindow().setAttributes(windowLayout);
        LinearLayout frame = new LinearLayout(this); frame.setOrientation(LinearLayout.VERTICAL);
        LinearLayout toolbar = new LinearLayout(this); toolbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(4), 0, dp(4), 0);
        Button home = new Button(this, null, android.R.attr.borderlessButtonStyle); home.setText(R.string.host_home);
        home.setContentDescription(getString(R.string.host_go_home)); home.setOnClickListener(view -> home());
        toolbar.addView(home, new LinearLayout.LayoutParams(-2, dp(48)));
        title = new TextView(this); title.setSingleLine(true); title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        tabButton = new Button(this, null, android.R.attr.borderlessButtonStyle);
        tabButton.setOnClickListener(view -> showTabs()); toolbar.addView(tabButton, new LinearLayout.LayoutParams(-2, dp(48)));
        Button add = new Button(this, null, android.R.attr.borderlessButtonStyle); addButton = add; add.setText("+");
        add.setContentDescription(getString(R.string.host_new_tab)); add.setOnClickListener(view -> newTab("/projects"));
        toolbar.addView(add, new LinearLayout.LayoutParams(dp(48), dp(48)));
        frame.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(56)));
        page = new FrameLayout(this); frame.addView(page, new LinearLayout.LayoutParams(-1, 0, 1));
        recovery = new LinearLayout(this); recovery.setOrientation(LinearLayout.VERTICAL);
        recovery.setPadding(dp(16), dp(16), dp(16), dp(16));
        message = new TextView(this); recovery.addView(message);
        progress = new ProgressBar(this); recovery.addView(progress);
        retry = new Button(this); retry.setText(R.string.host_retry); retry.setOnClickListener(view -> connect()); recovery.addView(retry);
        Button controls = new Button(this); controls.setText(R.string.host_controls); controls.setOnClickListener(view -> home());
        recovery.addView(controls); page.addView(recovery, new FrameLayout.LayoutParams(-1, -1));
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            int handled = android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout();
            android.graphics.Insets bars = insets.getInsets(handled);
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            // Native layout owns these edges. Zero them for WebView's CSS
            // safe areas while preserving keyboard/visual-viewport updates.
            return new android.view.WindowInsets.Builder(insets)
                .setInsets(handled, android.graphics.Insets.NONE).build();
        });
        setContentView(frame); restore();
        Tab initial = selected; selected = null;
        if (initial != null) activate(initial);
        provider(getIntent());
        if (selected == null) newTab("/projects");
    }
    @Override protected void onResume() { super.onResume(); activityResumed = resumed = true; if (web != null) web.onResume(); if (recovery != null) connect(); }
    @Override protected void onPause() {
        remember(); persist(); if (web != null) web.onPause();
        activityResumed = resumed = false; generation++; if (pending != null) pending.cancel(true); super.onPause();
    }
    @Override protected void onDestroy() {
        probes.shutdownNow(); handler.removeCallbacksAndMessages(null);
        if (popup != null) popup.destroy(); if (web != null) web.destroy(); super.onDestroy();
    }
}
