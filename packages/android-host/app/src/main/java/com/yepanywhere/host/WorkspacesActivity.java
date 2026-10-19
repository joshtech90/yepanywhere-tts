package com.yepanywhere.host;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.provider.DocumentsContract;
import android.provider.Settings;
import android.widget.*;
import java.util.concurrent.*;
import org.json.*;

/** Native folder onboarding; provider queries never compete with shortcut typing. */
public final class WorkspacesActivity extends Activity {
    private TextView message;
    private TextView shared, removable;
    private final BroadcastReceiver media = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { refresh(); }
    };
    private TextView mapping;
    private Button allFiles, apply, pick;
    private final java.util.List<android.view.View> actions = new java.util.ArrayList<>();
    private HostState.Watch watch;
    private boolean busy, visible;
    private LinearLayout rows;
    private WorkspaceRegistry registry;
    private String pending;
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(1), new ThreadPoolExecutor.DiscardOldestPolicy());
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private CancellationSignal query;
    private boolean destroyed;
    private int generation;
    private boolean renaming;
    private Button button(LinearLayout parent, String title, Runnable action) {
        Button button = new Button(this); button.setText(title); button.setAllCaps(false);
        button.setOnClickListener(view -> action.run()); parent.addView(button); actions.add(button); button.setEnabled(!busy); return button;
    }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved); registry = new WorkspaceRegistry(this);
        if (saved != null) pending = saved.getString("pending");
        LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL);
        int pad = (int)(20 * getResources().getDisplayMetrics().density); content.setPadding(pad, pad, pad, pad);
        TextView title = new TextView(this); title.setText(R.string.workspace_title); title.setTextSize(24); content.addView(title);
        TextView intro = new TextView(this); intro.setText(R.string.workspace_intro); content.addView(intro);
        pick = button(content, getString(R.string.workspace_pick), () -> choose(null));
        pick.setId(R.id.workspace_pick_action);
        allFiles = button(content, "All-files access", () -> {
            Runnable settings = () -> startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getPackageName())));
            if (Environment.isExternalStorageManager()) { settings.run(); return; }
            new AlertDialog.Builder(this).setTitle("Allow broad storage access?")
                .setMessage("This lets the app read, modify and delete files throughout accessible shared storage, including Downloads, Documents and photos. After restarting the host, primary shared storage is available at /sdcard and removable volumes at /storage/<volume-id>, without picking a folder. This access is broader than your selected folders. PRoot does not restrict that authority. SAF tools do not require this permission.")
                .setNegativeButton("Cancel", null).setPositiveButton("Open settings", (dialog, which) -> settings.run()).show();
        });
        apply = button(content, "Checking mappings…", () -> {
            Bundle state = HostState.read(this);
            if (HostState.active(state)) new AlertDialog.Builder(this).setTitle("Apply folder mappings?")
                .setMessage("This restarts the local host and interrupts active agent turns. Saved sessions stay on disk. Newly enabled, renamed or removed paths take effect on restart.")
                .setNegativeButton("Cancel", null).setPositiveButton("Restart host", (dialog, which) -> HostService.command(this, HostService.RESTART)).show();
            else HostService.command(this, HostService.START);
        }); apply.setEnabled(false);
        mapping = new TextView(this); content.addView(mapping);
        shared = new TextView(this); shared.setTextIsSelectable(true); content.addView(shared);
        removable = new TextView(this); removable.setTextIsSelectable(true); content.addView(removable);
        message = new TextView(this); message.setTextIsSelectable(true); content.addView(message);
        rows = new LinearLayout(this); rows.setOrientation(LinearLayout.VERTICAL); content.addView(rows);
        ScrollView scroll = new ScrollView(this); scroll.addView(content);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom); return insets;
        }); setContentView(scroll);
    }
    private void choose(String selected) {
        pending = selected; // Null means a new folder; Reselect retains its existing name.
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        // Initial location is only a picker hint; the actual result is always required.
        String initial = getIntent().getStringExtra("initialTree");
        if (initial != null) picker.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(initial));
        startActivityForResult(picker, 10);
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != 10 || result != RESULT_OK || data == null || data.getData() == null) { pending = null; return; }
        String selected = pending; pending = null; Uri tree = data.getData();
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (flags != (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION)) { message.setText(R.string.workspace_rw_required); return; }
        mutate(() -> {
            getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            CancellationSignal signal = new CancellationSignal();
            ScheduledFuture<?> deadline = timer.schedule(signal::cancel, 15, TimeUnit.SECONDS);
            try {
                if (selected == null) registry.add(tree, signal); else registry.select(selected, tree);
            }
            catch (Exception error) {
                // Do not leave a new orphan grant after rejected duplicate/invalid selections.
                boolean used = false; JSONArray roots = registry.roots();
                for (int i = 0; i < roots.length(); i++) if (tree.toString().equals(roots.getJSONObject(i).getString("tree"))) used = true;
                if (!used) getContentResolver().releasePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                throw error;
            } finally { deadline.cancel(false); }
        });
    }
    private interface Mutation { void run() throws Exception; }
    private void mutate(Mutation mutation) {
        if (busy || destroyed) return;
        busy = true; for (android.view.View action : actions) action.setEnabled(false);
        message.setText(R.string.workspace_saving);
        if (query != null) query.cancel();
        worker.execute(() -> {
            String error = null;
            try { mutation.run(); } catch (Exception failure) { error = String.valueOf(failure.getMessage()); }
            String result = error;
            runOnUiThread(() -> {
                if (destroyed) return;
                busy = false;
                for (android.view.View action : actions) action.setEnabled(true);
                message.setText(result == null ? getString(R.string.workspace_saved) : result);
                refresh();
            });
        });
    }
    EditText rename(String old) {
        EditText edit = new EditText(this); edit.setId(R.id.workspace_name); edit.setSingleLine(); edit.setText(old);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Rename shortcut")
            .setMessage("Changing the name changes its /workspaces path after restart.").setView(edit)
            .setNegativeButton("Cancel", null).setPositiveButton("Save", null).create();
        renaming = true;
        dialog.setOnDismissListener(ignored -> { renaming = false; refresh(); });
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            String renamed = edit.getText().toString();
            try { WorkspaceRegistry.name(renamed); }
            catch (Exception error) { edit.setError(error.getMessage()); return; }
            mutate(() -> registry.change(old, renamed, null)); dialog.dismiss();
        })); dialog.show(); return edit;
    }
    void refresh() {
        // Refresh again on dismiss; results have no visible consumer during Rename.
        if (destroyed || !visible || busy || renaming) return;
        String access = Environment.isExternalStorageManager() ? "All-files access: Allowed\nManage access" : "All-files access: Off (optional)\nAllow access";
        if (!access.contentEquals(allFiles.getText())) allFiles.setText(access);
        Bundle snapshot = HostState.read(this);
        String phase = snapshot.getString("phase", "stopped");
        boolean active = "ready".equals(phase);
        java.util.Map<String, String> applied = active ? HostState.mappings(snapshot) : java.util.Collections.emptyMap();
        java.util.Map<String, String> appliedVolumes = active ? HostState.mappings(snapshot, "volumes") : java.util.Collections.emptyMap();
        java.util.Set<String> invalidated = HostState.invalidVolumes(snapshot);
        String appliedShared = active ? snapshot.getString("shared") : null;
        boolean transitioning = "starting".equals(phase) || "stopping".equals(phase);
        if (transitioning) { apply.setText("starting".equals(phase) ? "Starting host…" : "Stopping host…"); apply.setEnabled(false); }
        int current = ++generation;
        if (query != null) query.cancel();
        CancellationSignal signal = new CancellationSignal(); query = signal;
        worker.execute(() -> {
            ScheduledFuture<?> deadline = null;
            try {
                deadline = timer.schedule(signal::cancel, 15, TimeUnit.SECONDS);
                JSONObject storage = WorkspaceRuntime.sharedStatus(this, appliedShared);
                JSONArray volumes = WorkspaceRuntime.volumeStatus(this, appliedVolumes, invalidated);
                JSONArray status = registry.status(signal, applied);
                runOnUiThread(() -> {
                    if (destroyed || !visible || busy || renaming || current != generation) return;
                    rows.removeAllViews();
                    actions.removeIf(view -> view != pick && view != allFiles && view != apply);
                    java.util.Map<String, String> desired = new java.util.HashMap<>();
                    for (int i = 0; i < status.length(); i++) try {
                        JSONObject root = status.getJSONObject(i);
                        if (root.getBoolean("directAvailable")) desired.put(root.getString("name"), root.getString("tree"));
                    } catch (Exception error) { message.setText(error.getMessage()); }
                    shared.setText(getString(R.string.workspace_shared, storage.optBoolean("mapped") ? getString(R.string.workspace_mapped) :
                        storage.optBoolean("available") ? getString(R.string.workspace_ready) : storage.optString("reason")));
                    String desiredShared = storage.optBoolean("available") ? storage.optString("source") : null;
                    java.util.Map<String, String> desiredVolumes = new java.util.HashMap<>();
                    StringBuilder volumeText = new StringBuilder();
                    for (int i = 0; i < volumes.length(); i++) try {
                        JSONObject volume = volumes.getJSONObject(i);
                        if (volume.optBoolean("available")) desiredVolumes.put(volume.getString("id"), volume.getString("source"));
                        if (volumeText.length() > 0) volumeText.append("\n");
                        volumeText.append(volume.getString("label")).append(" · ").append(volume.isNull("path") ? "No stable path" : volume.getString("path"))
                            .append("\n").append(volume.optBoolean("mapped") ? getString(R.string.workspace_mapped) :
                                volume.has("reason") ? volume.optString("reason") : getString(R.string.workspace_ready));
                    } catch (Exception error) { message.setText(error.getMessage()); }
                    removable.setText(volumeText.length() == 0 ? "No removable storage detected" : volumeText);
                    boolean changed = active && (!desired.equals(applied) || !java.util.Objects.equals(desiredShared, appliedShared) ||
                        !desiredVolumes.equals(appliedVolumes) || !invalidated.isEmpty());
                    mapping.setText(changed ? getString(R.string.workspace_pending) : transitioning ? snapshot.getString("detail") :
                        active ? "Mappings are up to date" : "Mappings will apply on the next host start");
                    if (!transitioning) { apply.setText(active ? changed ? "Restart to apply changes" : "Mappings up to date" : "Start host with mappings"); apply.setEnabled(!active || changed); }
                    pick.setText(getString(R.string.workspace_pick_count, status.length())); pick.setEnabled(status.length() < 16);
                    if (status.length() == 16) mapping.append("\nFolder limit reached. Remove a shortcut before adding another.");
                    if (status.length() == 0 && !changed) mapping.append("\n" + getString(R.string.workspace_empty));
                    for (int i = 0; i < status.length(); i++) try { row(status.getJSONObject(i)); }
                    catch (Exception error) { message.setText(error.getMessage()); }
                });
            } catch (Exception error) { runOnUiThread(() -> { if (!destroyed && visible && current == generation) message.setText(String.valueOf(error.getMessage())); }); }
            finally { if (deadline != null) deadline.cancel(false); }
        });
    }
    private void row(JSONObject root) throws Exception {
        String alias = root.getString("name");
        TextView title = new TextView(this); title.setText(getString(R.string.workspace_row, alias, root.getString("path"))); title.setTextSize(19); rows.addView(title);
        TextView health = new TextView(this); health.setText(getString(R.string.workspace_health, root.getBoolean("safAvailable") ? getString(R.string.workspace_saf_available) : root.optString("safReason"),
            root.getBoolean("mapped") ? getString(R.string.workspace_mapped) : root.getBoolean("directAvailable") ? getString(R.string.workspace_ready) : root.optString("directReason"),
            root.getJSONArray("overlaps").length() > 0 ? getString(R.string.workspace_overlap, root.getJSONArray("overlaps")) : "")); rows.addView(health);
        CheckBox direct = new CheckBox(this);
        String directState = !root.getBoolean("direct") ? "Off" : root.getBoolean("mapped") ? "Active" : root.getBoolean("directAvailable") ? "Enabled · awaiting host start/restart" : "Enabled · unavailable";
        direct.setText(getString(R.string.host_two_lines, getString(R.string.workspace_direct, alias), directState)); direct.setChecked(root.getBoolean("direct")); actions.add(direct); direct.setEnabled(!busy);
        direct.setOnCheckedChangeListener((button, checked) -> mutate(() -> registry.change(alias, alias, checked))); rows.addView(direct);
        button(rows, (root.getBoolean("safAvailable") ? "Reselect " : "Repair access · Reselect ") + alias, () -> choose(alias));
        button(rows, "Rename " + alias, () -> rename(alias));
        button(rows, "Remove " + alias, () -> new AlertDialog.Builder(this).setTitle("Remove shortcut " + alias + "?")
            .setMessage("Files will stay in the selected folder. This removes its registration and releases unused folder permission. Restart to apply direct mapping changes.")
            .setNegativeButton("Cancel", null).setPositiveButton("Remove shortcut", (dialog, which) -> mutate(() -> registry.remove(alias))).show());
    }
    // mediaFilter contains only protected system broadcasts; lint cannot follow the helper.
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    @Override public void onResume() { super.onResume(); visible = true; registerReceiver(media, WorkspaceRuntime.mediaFilter()); watch = new HostState.Watch(this, this::refresh); refresh(); }
    @Override public void onPause() { visible = false; unregisterReceiver(media); generation++; if (watch != null) { watch.close(); watch = null; } if (query != null) query.cancel(); super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); out.putString("pending", pending); }
    @Override public void onDestroy() { destroyed = true; if (query != null) query.cancel(); worker.shutdownNow(); timer.shutdownNow(); super.onDestroy(); }
}
