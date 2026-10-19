package com.yepanywhere.host.workspacespike;

import android.app.Activity;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.Settings;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import dev.machinecontrol.android.storage.LocalWorkspace;
import java.nio.file.Files;
import org.json.JSONObject;

/** Disposable native consent surface. No bridge, credentials or host mutations. */
public final class WorkspaceActivity extends Activity {
    private TextView status;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        column.setPadding(padding, padding + 48, padding, padding);
        status = new TextView(this); status.setTextSize(18); column.addView(status);
        button(column, getString(R.string.choose_folder), () -> {
            Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            String initial = getIntent().getStringExtra("initialTree");
            if (initial != null) picker.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(initial));
            startActivityForResult(picker, 1);
        });
        button(column, getString(R.string.all_files), () -> startActivity(new Intent(
            Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getPackageName()))));
        button(column, getString(R.string.revoke_folder), () -> {
            String selected = getPreferences(0).getString("tree", null);
            if (selected != null) getContentResolver().releasePersistableUriPermission(Uri.parse(selected),
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            refresh();
        });
        ScrollView scroll = new ScrollView(this); scroll.addView(column); setContentView(scroll);
    }
    private void button(LinearLayout column, String label, Runnable action) {
        Button button = new Button(this); button.setText(label); button.setAllCaps(false);
        button.setOnClickListener(view -> action.run()); column.addView(button);
    }
    // Synchronous commit makes the selection durable before fixture readiness.
    @SuppressLint("ApplySharedPref")
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 1 && result == RESULT_OK && data != null && data.getData() != null) {
            int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if ((flags & Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0 || (flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) == 0) {
                status.setText(R.string.read_write_required); return;
            }
            getContentResolver().takePersistableUriPermission(data.getData(), Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            getPreferences(0).edit().putString("tree", data.getData().toString()).commit();
        }
        refresh();
    }
    @Override public void onResume() { super.onResume(); refresh(); }
    private void refresh() {
        if (status == null) return;
        JSONObject record = new JSONObject();
        try {
            String selected = getPreferences(0).getString("tree", null);
            if (selected == null) throw new IllegalStateException("Choose a local shared folder");
            record.put("tree", selected);
            java.io.File root = LocalWorkspace.resolve(this, Uri.parse(selected));
            record.put("available", true).put("path", root.toString()).put("tree", selected);
            Files.write(new java.io.File(getFilesDir(), "admitted-path.txt").toPath(), root.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            status.setText(getString(R.string.ready, root));
        } catch (Exception error) {
            try { record.put("available", false).put("reason", error.getMessage()); } catch (Exception ignored) { }
            status.setText(getString(R.string.unavailable, error.getMessage()));
        }
        try { Files.write(new java.io.File(getFilesDir(), "selection.json").toPath(), record.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
        catch (Exception error) { status.setText(R.string.persist_failed); }
    }
}
