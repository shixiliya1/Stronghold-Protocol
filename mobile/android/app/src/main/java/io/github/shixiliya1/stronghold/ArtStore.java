package io.github.shixiliya1.stronghold;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * The game art outside the APK (since 0.2.4-android.2): the art pack (.github/scripts/art-pack.py, release art-<hash12>)
 * is downloaded once into filesDir/art and served from there (ArtWebViewClient). An app update that keeps the same art
 * hash keeps the installed art; a new hash downloads the new pack. The bundled www/client/art-pack.json names the pack.
 */
final class ArtStore {
    static final String STATE = ".art-state.json";

    private ArtStore() {}

    static File artDir(Context c) { return new File(c.getFilesDir(), "art"); }

    static JSONObject pack(Context c) {
        try (InputStream in = c.getAssets().open("public/client/art-pack.json")) {
            return new JSONObject(readAll(in));
        } catch (Exception e) {
            return null; // a build with the art inside (no pack)
        }
    }

    static String installedHash(Context c) {
        File f = new File(artDir(c), STATE);
        if (!f.isFile()) return null;
        try (InputStream in = new FileInputStream(f)) {
            return new JSONObject(readAll(in)).optString("hash", null);
        } catch (Exception e) {
            return null;
        }
    }

    /** Art present: no pack to install (art bundled), or the installed hash is the pack's. */
    static boolean ready(Context c) {
        JSONObject p = pack(c);
        if (p == null) return true;
        String h = installedHash(c);
        return h != null && h.equals(p.optString("hash"));
    }

    static String readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[16384];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        return out.toString(StandardCharsets.UTF_8.name());
    }
}
