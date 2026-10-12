package io.github.shixiliya1.stronghold;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;

/**
 * ArtPack (JS: Capacitor.registerPlugin('ArtPack')): status() and start() — downloads the art pack zip into
 * filesDir/art-pack (HTTP Range resume across restarts; retries; mirrors gh-proxy.com / ghfast.top when GitHub fails),
 * verifies its sha256, extracts it to filesDir/art and deletes the zip. Progress: listener 'progress'
 * { phase: download|verify|extract|done|error, bytes, total, files, message, mirror }.
 */
@CapacitorPlugin(name = "ArtPack")
public class ArtPackPlugin extends Plugin {
    private static final String[] MIRRORS = { "", "https://ghfast.top/", "https://gh-proxy.com/" };
    private volatile Thread worker;
    private volatile JSObject last;

    @PluginMethod
    public void status(PluginCall call) {
        JSObject o = new JSObject();
        JSONObject p = ArtStore.pack(getContext());
        o.put("ready", ArtStore.ready(getContext()));
        o.put("pack", p != null);
        o.put("running", worker != null);
        if (p != null) {
            o.put("tag", p.optString("tag"));
            o.put("total", p.optLong("zipSize"));
            File part = partFile(p);
            o.put("have", part.isFile() ? part.length() : 0);
        }
        if (last != null) o.put("last", last);
        call.resolve(o);
    }

    @PluginMethod
    public void start(PluginCall call) {
        final JSONObject p = ArtStore.pack(getContext());
        if (p == null || ArtStore.ready(getContext())) { call.resolve(new JSObject().put("ready", true)); return; }
        if (worker == null) {
            worker = new Thread(() -> {
                try { run(p); } catch (Throwable t) { emit("error", 0, 0, String.valueOf(t.getMessage()), -1); }
                finally { worker = null; }
            }, "art-pack");
            worker.start();
        }
        call.resolve(new JSObject().put("started", true));
    }

    private File packDir() { return new File(getContext().getFilesDir(), "art-pack"); }
    private File partFile(JSONObject p) { return new File(packDir(), p.optString("zip") + ".part"); }

    private void emit(String phase, long bytes, long total, String msg, int mirror) {
        JSObject o = new JSObject();
        o.put("phase", phase); o.put("bytes", bytes); o.put("total", total);
        if (msg != null) o.put("message", msg);
        if (mirror >= 0) o.put("mirror", mirror);
        last = o;
        notifyListeners("progress", o);
    }

    private void run(JSONObject p) throws Exception {
        File dir = packDir();
        dir.mkdirs();
        File part = partFile(p);
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) if (!f.getName().equals(part.getName())) f.delete(); // older packs
        long total = p.getLong("zipSize");
        String direct = p.getString("base").replaceAll("/+$", "") + "/" + p.getString("tag") + "/" + p.getString("zip");
        List<String> urls = new ArrayList<>();
        for (String m : MIRRORS) urls.add(m + direct);
        Exception lastErr = null;
        boolean done = part.isFile() && part.length() == total;
        for (int mi = 0; mi < urls.size() && !done; mi++) {
            for (int attempt = 0; attempt < 3 && !done; attempt++) {
                try { download(urls.get(mi), part, total, mi); done = true; }
                catch (Exception e) { lastErr = e; Thread.sleep(1500L * (attempt + 1)); }
            }
        }
        if (!done) throw lastErr != null ? lastErr : new Exception("download failed");
        emit("verify", total, total, null, -1);
        String sha = sha256(part);
        if (!sha.equalsIgnoreCase(p.getString("zipSha256"))) { part.delete(); throw new Exception("sha256 不匹配，已删除，请重试"); }
        File tmp = new File(getContext().getFilesDir(), "art.new");
        deleteTree(tmp);
        extract(part, tmp, p.optInt("files", 0));
        try (OutputStream o = new FileOutputStream(new File(tmp, ArtStore.STATE))) {
            o.write(new JSONObject().put("hash", p.getString("hash")).put("tag", p.getString("tag")).toString().getBytes(StandardCharsets.UTF_8));
        }
        File art = ArtStore.artDir(getContext());
        deleteTree(art);
        if (!tmp.renameTo(art)) throw new Exception("无法写入美术目录");
        part.delete();
        emit("done", total, total, null, -1);
    }

    private void download(String url, File part, long total, int mirror) throws Exception {
        long have = part.isFile() ? part.length() : 0;
        if (have > total) { part.delete(); have = 0; }
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "Stronghold-Protocol-Android");
        if (have > 0) c.setRequestProperty("Range", "bytes=" + have + "-");
        int code = c.getResponseCode();
        if (code == 416 && have == total) return;
        if (code != 200 && code != 206) throw new Exception("HTTP " + code);
        if (code == 200) have = 0; // no Range support: from the start
        try (InputStream in = new BufferedInputStream(c.getInputStream()); RandomAccessFile out = new RandomAccessFile(part, "rw")) {
            out.setLength(have);
            out.seek(have);
            byte[] b = new byte[1 << 16];
            int n;
            long lastEmit = 0;
            while ((n = in.read(b)) > 0) {
                out.write(b, 0, n);
                have += n;
                long now = System.currentTimeMillis();
                if (now - lastEmit > 300) { emit("download", have, total, null, mirror); lastEmit = now; }
            }
        } finally { c.disconnect(); }
        if (have != total) throw new Exception("下载不完整 " + have + "/" + total);
        emit("download", have, total, null, mirror);
    }

    private void extract(File zip, File dst, int files) throws Exception {
        String root = dst.getCanonicalPath() + File.separator;
        int count = 0;
        try (ZipInputStream z = new ZipInputStream(new BufferedInputStream(new FileInputStream(zip), 1 << 16))) {
            ZipEntry e;
            byte[] b = new byte[1 << 16];
            while ((e = z.getNextEntry()) != null) {
                File f = new File(dst, e.getName());
                if (!f.getCanonicalPath().startsWith(root)) throw new Exception("bad entry " + e.getName());
                if (e.isDirectory()) { f.mkdirs(); continue; }
                f.getParentFile().mkdirs();
                try (OutputStream o = new FileOutputStream(f)) { int n; while ((n = z.read(b)) > 0) o.write(b, 0, n); }
                if (++count % 200 == 0) emit("extract", count, files, null, -1);
            }
        }
    }

    private static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) { byte[] b = new byte[1 << 16]; int n; while ((n = in.read(b)) > 0) md.update(b, 0, n); }
        StringBuilder s = new StringBuilder();
        for (byte x : md.digest()) s.append(String.format("%02x", x));
        return s.toString();
    }

    private static void deleteTree(File f) {
        if (!f.exists()) return;
        File[] l = f.listFiles();
        if (l != null) for (File x : l) deleteTree(x);
        f.delete();
    }
}
