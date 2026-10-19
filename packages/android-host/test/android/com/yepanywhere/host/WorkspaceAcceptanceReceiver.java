package com.yepanywhere.host;

import android.content.*;
import android.net.Uri;
import java.io.File;
import java.nio.file.Files;
import org.json.JSONObject;

/** Compiled ONLY into the separately identified physical acceptance APK. */
public final class WorkspaceAcceptanceReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        try {
            WorkspaceRegistry registry = new WorkspaceRegistry(context);
            String op = intent.getStringExtra("op");
            if ("revoke".equals(op)) {
                Uri tree = Uri.parse(registry.root(intent.getStringExtra("root")).getString("tree"));
                context.getContentResolver().releasePersistableUriPermission(tree,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } else if ("direct".equals(op)) {
                String root = intent.getStringExtra("root"); registry.change(root, root, intent.getBooleanExtra("enabled", false));
            } else throw new IllegalArgumentException("Unknown acceptance operation");
            Files.write(new File(context.getFilesDir(), "acceptance-action.json").toPath(), new JSONObject().put("ok", true).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } catch (Exception error) { throw new IllegalStateException(error); }
    }
}
