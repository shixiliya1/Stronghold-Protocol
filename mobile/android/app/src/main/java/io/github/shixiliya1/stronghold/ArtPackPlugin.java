package io.github.shixiliya1.stronghold;

import com.getcapacitor.JSArray;
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
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * ArtPack (JS: Capacitor.registerPlugin('ArtPack')): status() and start() — downloads the art pack zip into
 * filesDir/art-pack (HTTP Range resume across restarts; retries; mirrors gh-proxy.com / ghfast.top when GitHub fails),
 * verifies its sha256, extracts it to filesDir/art and deletes the zip. Progress: listener 'progress'
 * { phase: download|verify|extract|done|error, bytes, total, files, message, mirror }.
 * 存储管理 (mobile/src/client/storage.js): storage() sizes, clearCache(), removeLeftover(), deleteArt(), and
 * verify() — re-hashes every installed file against the pack's art-manifest.json (sha256 per file) and re-downloads the
 * bad / missing ones by HTTP Range out of the (stored, uncompressed) zip; progress phase 'check' / 'repair'.
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

    // ---- 存储管理 ----------------------------------------------------------------------------------------------

    private static long[] treeSize(File f) {
        if (f == null || !f.exists()) return new long[] { 0, 0 };
        if (f.isFile()) return new long[] { f.length(), 1 };
        long[] t = { 0, 0 };
        File[] l = f.listFiles();
        if (l != null) for (File x : l) { long[] c = treeSize(x); t[0] += c[0]; t[1] += c[1]; }
        return t;
    }

    private File tmpDir() { return new File(getContext().getFilesDir(), "art.new"); }

    /** Bytes of art-pack/ files that are not the current pack's partial (older packs). */
    private long oldParts(JSONObject p) {
        long n = 0;
        File[] l = packDir().listFiles();
        if (l != null) for (File f : l) if (p == null || !f.getName().equals(partFile(p).getName())) n += treeSize(f)[0];
        return n;
    }

    @PluginMethod
    public void storage(PluginCall call) {
        JSONObject p = ArtStore.pack(getContext());
        File art = ArtStore.artDir(getContext());
        long[] a = treeSize(art);
        JSObject o = new JSObject();
        o.put("pack", p != null);
        o.put("ready", ArtStore.ready(getContext()));
        o.put("running", worker != null);
        o.put("artBytes", a[0]);
        o.put("artFiles", a[1]);
        o.put("partBytes", p != null && partFile(p).isFile() ? partFile(p).length() : 0);
        o.put("leftoverBytes", treeSize(tmpDir())[0] + oldParts(p));
        File fd = getContext().getFilesDir();
        o.put("free", fd.getUsableSpace());
        o.put("size", fd.getTotalSpace());
        if (p != null) { o.put("tag", p.optString("tag")); o.put("total", p.optLong("bytes")); o.put("files", p.optInt("files")); o.put("zipSize", p.optLong("zipSize")); }
        o.put("installed", ArtStore.installedHash(getContext()));
        long[] cas = treeSize(CasStore.dir(getContext()));
        o.put("casBytes", cas[0]);
        o.put("casFiles", cas[1]);
        call.resolve(o);
    }

    // ---- resource cache (CasStore; public/js/resources.js) ------------------------------------------------------

    @PluginMethod
    public void casList(PluginCall call) {
        JSArray a = new JSArray();
        File[] l = CasStore.dir(getContext()).listFiles();
        if (l != null) for (File f : l) if (CasStore.isHash(f.getName())) a.put(f.getName());
        call.resolve(new JSObject().put("hashes", a));
    }

    @PluginMethod
    public void casPut(PluginCall call) {
        try {
            byte[] b = android.util.Base64.decode(call.getString("data", ""), android.util.Base64.DEFAULT);
            CasStore.put(getContext(), call.getString("hash", ""), b);
            call.resolve(new JSObject().put("bytes", b.length));
        } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
    }

    @PluginMethod
    public void casActivate(PluginCall call) {
        try {
            JSObject m = call.getObject("map", new JSObject());
            call.resolve(new JSObject().put("active", CasStore.activate(getContext(), m)));
        } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
    }

    @PluginMethod
    public void casClear(PluginCall call) {
        long n = treeSize(CasStore.dir(getContext()))[0];
        CasStore.clear(getContext());
        call.resolve(new JSObject().put("freed", n));
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        if (worker != null) { call.reject("下载进行中，请稍后"); return; }
        long n = treeSize(packDir())[0] + treeSize(tmpDir())[0];
        deleteTree(packDir());
        deleteTree(tmpDir());
        last = null;
        call.resolve(new JSObject().put("freed", n));
    }

    @PluginMethod
    public void removeLeftover(PluginCall call) {
        if (worker != null) { call.reject("下载进行中，请稍后"); return; }
        JSONObject p = ArtStore.pack(getContext());
        long n = treeSize(tmpDir())[0] + oldParts(p);
        deleteTree(tmpDir());
        File[] l = packDir().listFiles();
        if (l != null) for (File f : l) if (p == null || !f.getName().equals(partFile(p).getName())) deleteTree(f);
        call.resolve(new JSObject().put("freed", n));
    }

    @PluginMethod
    public void deleteArt(PluginCall call) {
        if (worker != null) { call.reject("下载进行中，请稍后"); return; }
        long n = treeSize(ArtStore.artDir(getContext()))[0];
        deleteTree(ArtStore.artDir(getContext()));
        last = null;
        call.resolve(new JSObject().put("freed", n));
    }

    @PluginMethod
    public void verify(final PluginCall call) {
        final JSONObject p = ArtStore.pack(getContext());
        if (p == null) { call.resolve(new JSObject().put("checked", 0).put("bad", 0)); return; }
        if (worker != null) { call.reject("下载进行中，请稍后"); return; }
        worker = new Thread(() -> {
            try { call.resolve(verifyRun(p)); }
            catch (Throwable t) { emit("error", 0, 0, String.valueOf(t.getMessage()), -1); call.reject(String.valueOf(t.getMessage())); }
            finally { worker = null; }
        }, "art-verify");
        worker.start();
    }

    private String fetchText(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(30000); c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "Stronghold-Protocol-Android");
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            try (InputStream in = c.getInputStream()) { return ArtStore.readAll(in); }
        } finally { c.disconnect(); }
    }

    private JSObject verifyRun(JSONObject p) throws Exception {
        String base = p.getString("base").replaceAll("/+$", "") + "/" + p.getString("tag") + "/";
        JSONObject man = null;
        Exception err = null;
        int mirror = 0;
        for (int mi = 0; mi < MIRRORS.length && man == null; mi++) {
            try { man = new JSONObject(fetchText(MIRRORS[mi] + base + "art-manifest.json")); mirror = mi; } catch (Exception e) { err = e; }
        }
        if (man == null) throw new Exception("无法下载校验清单：" + (err != null ? err.getMessage() : ""));
        if (!man.optString("hash").equals(p.optString("hash"))) throw new Exception("校验清单与美术包不一致");
        JSONArray es = man.getJSONArray("entries");
        File art = ArtStore.artDir(getContext());
        List<JSONObject> bad = new ArrayList<>();
        int n = es.length();
        for (int i = 0; i < n; i++) {
            JSONObject e = es.getJSONObject(i);
            File f = new File(art, e.getString("p"));
            if (!f.isFile() || f.length() != e.getLong("s") || !sha256(f).equalsIgnoreCase(e.getString("h"))) bad.add(e);
            if (i % 200 == 0) emit("check", i, n, null, -1);
        }
        int fixed = 0;
        String zip = MIRRORS[mirror] + base + p.getString("zip");
        for (JSONObject e : bad) {
            fetchEntry(zip, e, new File(art, e.getString("p")));
            if (++fixed % 20 == 0 || fixed == bad.size()) emit("repair", fixed, bad.size(), null, mirror);
        }
        if (bad.size() > 0 || !ArtStore.ready(getContext())) {
            try (OutputStream o = new FileOutputStream(new File(art, ArtStore.STATE))) {
                o.write(new JSONObject().put("hash", p.getString("hash")).put("tag", p.getString("tag")).toString().getBytes(StandardCharsets.UTF_8));
            }
        }
        emit("done", n, n, null, -1);
        return new JSObject().put("checked", n).put("bad", bad.size()).put("repaired", fixed);
    }

    private void fetchEntry(String zip, JSONObject e, File dst) throws Exception {
        long o = e.getLong("o"), size = e.getLong("s");
        HttpURLConnection c = (HttpURLConnection) new URL(zip).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(30000); c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "Stronghold-Protocol-Android");
        c.setRequestProperty("Range", "bytes=" + o + "-" + (o + size - 1));
        File part = new File(dst.getPath() + ".part");
        try {
            if (c.getResponseCode() != 206) throw new Exception("HTTP " + c.getResponseCode() + "（服务器不支持分段下载，请用「重新下载美术资源」）");
            dst.getParentFile().mkdirs();
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (InputStream in = new BufferedInputStream(c.getInputStream()); OutputStream out = new FileOutputStream(part)) {
                byte[] b = new byte[1 << 16]; int k; long got = 0;
                while ((k = in.read(b)) > 0) { out.write(b, 0, k); md.update(b, 0, k); got += k; }
                if (got != size) throw new Exception("下载不完整 " + e.getString("p"));
            }
            StringBuilder h = new StringBuilder();
            for (byte x : md.digest()) h.append(String.format("%02x", x));
            if (!h.toString().equalsIgnoreCase(e.getString("h"))) { part.delete(); throw new Exception("sha256 不匹配 " + e.getString("p")); }
            dst.delete();
            if (!part.renameTo(dst)) throw new Exception("无法写入 " + e.getString("p"));
        } finally { c.disconnect(); }
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
