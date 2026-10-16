package io.github.shixiliya1.stronghold;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

/**
 * Serves the downloaded art (filesDir/art: assets/…, data/local-assets.json) at the app's own origin, exactly where the
 * page expects it (/assets/…, /data/local-assets.json), and /client/art-state.js (window.SP_ART: is the art installed).
 * Everything else — and art not installed — goes to Capacitor's local server (the bundled www).
 */
public class ArtWebViewClient extends BridgeWebViewClient {
    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("png", "image/png"); MIME.put("webp", "image/webp"); MIME.put("jpg", "image/jpeg");
        MIME.put("mp3", "audio/mpeg"); MIME.put("ogg", "audio/ogg"); MIME.put("json", "application/json");
        MIME.put("atlas", "text/plain"); MIME.put("skel", "application/octet-stream"); MIME.put("obj", "text/plain");
        MIME.put("svg", "image/svg+xml"); MIME.put("txt", "text/plain");
    }
    private final Context ctx;

    public ArtWebViewClient(Bridge bridge, Context ctx) {
        super(bridge);
        this.ctx = ctx.getApplicationContext();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri u = request.getUrl();
        String host = u.getHost();
        String path = u.getPath();
        if (host != null && host.equals("localhost") && path != null) {
            if (path.equals("/client/art-state.js")) return artState();
            if (path.startsWith("/assets/")) {
                File over = CasStore.fileFor(ctx, path); // a server's mod overlay (CasStore)
                if (over != null) { WebResourceResponse r = fileResponse(over, path); if (r != null) return r; }
            }
            if (path.startsWith("/assets/") || path.equals("/data/local-assets.json") || path.equals("/data/local-fx.json")) {
                WebResourceResponse r = artFile(path);
                if (r != null) return r;
            }
        }
        return super.shouldInterceptRequest(view, request);
    }

    private WebResourceResponse artState() {
        JSONObject o = new JSONObject();
        try {
            JSONObject p = ArtStore.pack(ctx);
            o.put("ready", ArtStore.ready(ctx));
            o.put("pack", p != null);
            if (p != null) { o.put("tag", p.optString("tag")); o.put("bytes", p.optLong("zipSize")); }
            o.put("installed", ArtStore.installedHash(ctx));
        } catch (Exception ignored) { /* best effort */ }
        byte[] b = ("window.SP_ART=" + o + ";\n").getBytes(StandardCharsets.UTF_8);
        WebResourceResponse r = new WebResourceResponse("application/javascript", "utf-8", new ByteArrayInputStream(b));
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        r.setResponseHeaders(h);
        return r;
    }

    private WebResourceResponse artFile(String path) {
        if (path.contains("..") || path.contains("/.")) return null;
        File f = new File(ArtStore.artDir(ctx), path.substring(1));
        if (!f.isFile()) return null;
        return fileResponse(f, f.getName());
    }

    private WebResourceResponse fileResponse(File f, String mimeName) {
        if (!f.isFile()) return null;
        try {
            String name = mimeName.substring(mimeName.lastIndexOf('/') + 1);
            int dot = name.lastIndexOf('.');
            String mime = dot >= 0 ? MIME.get(name.substring(dot + 1).toLowerCase()) : null;
            if (mime == null) mime = "application/octet-stream";
            WebResourceResponse r = new WebResourceResponse(mime, mime.startsWith("text/") || mime.endsWith("json") ? "utf-8" : null, new FileInputStream(f));
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "max-age=31536000");
            h.put("Access-Control-Allow-Origin", "*");
            h.put("Content-Length", String.valueOf(f.length()));
            r.setResponseHeaders(h);
            return r;
        } catch (Exception e) {
            return null;
        }
    }
}
