package io.github.shixiliya1.stronghold;

import android.content.Context;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import org.json.JSONObject;

/**
 * Content-addressed resource cache (shared/resources.js, public/js/resources.js): filesDir/cas/<sha256>, one copy per
 * file whatever server brought it, verified on the way in; overlay.json = the joined server's mod overlay
 * (assets/… → sha256), served by ArtWebViewClient ahead of the installed art.
 */
final class CasStore {
    private static volatile Map<String, String> overlay;

    private CasStore() {}

    static File dir(Context c) { return new File(c.getFilesDir(), "cas"); }

    static boolean isHash(String h) { return h != null && h.matches("[0-9a-f]{64}"); }

    static String sha256(byte[] b) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        StringBuilder s = new StringBuilder();
        for (byte x : md.digest(b)) s.append(String.format("%02x", x));
        return s.toString();
    }

    static void put(Context c, String h, byte[] b) throws Exception {
        if (!isHash(h) || !sha256(b).equals(h)) throw new Exception("sha256 mismatch");
        File d = dir(c);
        d.mkdirs();
        File tmp = new File(d, h + ".tmp");
        try (OutputStream o = new FileOutputStream(tmp)) { o.write(b); }
        if (!tmp.renameTo(new File(d, h))) throw new Exception("cannot store " + h);
    }

    static int activate(Context c, JSONObject map) throws Exception {
        Map<String, String> m = new HashMap<>();
        JSONObject out = new JSONObject();
        Iterator<String> it = map.keys();
        while (it.hasNext()) {
            String rel = it.next();
            String h = map.optString(rel);
            if (rel.startsWith("assets/") && !rel.contains("..") && isHash(h) && new File(dir(c), h).isFile()) { m.put(rel, h); out.put(rel, h); }
        }
        dir(c).mkdirs();
        try (OutputStream o = new FileOutputStream(new File(dir(c), "overlay.json"))) { o.write(out.toString().getBytes(StandardCharsets.UTF_8)); }
        overlay = m;
        return m.size();
    }

    /** The overlay file for a request path (/assets/…), or null. */
    static File fileFor(Context c, String path) {
        Map<String, String> m = overlay;
        if (m == null) {
            m = new HashMap<>();
            File f = new File(dir(c), "overlay.json");
            if (f.isFile()) {
                try (InputStream in = new FileInputStream(f)) {
                    JSONObject o = new JSONObject(ArtStore.readAll(in));
                    Iterator<String> it = o.keys();
                    while (it.hasNext()) { String k = it.next(); m.put(k, o.optString(k)); }
                } catch (Exception ignored) { /* no overlay */ }
            }
            overlay = m;
        }
        String h = m.get(path.startsWith("/") ? path.substring(1) : path);
        if (h == null) return null;
        File f = new File(dir(c), h);
        return f.isFile() ? f : null;
    }

    static void clear(Context c) {
        File[] l = dir(c).listFiles();
        if (l != null) for (File f : l) f.delete();
        overlay = new HashMap<>();
    }
}
