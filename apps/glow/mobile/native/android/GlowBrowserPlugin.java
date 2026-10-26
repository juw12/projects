package io.github.juw12.glow;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The browser built into the Glow app. GlowLead (in the main app view) drives it one action at a time through
 * the shared Glow Hands core: open a page, evaluate a small script, go back. The page itself gets no bridge to the
 * app (no JavaScript interface), only http/https pages load, and the person can watch, scroll and type in it.
 */
@CapacitorPlugin(name = "GlowBrowser")
public class GlowBrowserPlugin extends Plugin {
    private static final long LOAD_TIMEOUT_MS = 30000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private LinearLayout panel;
    private WebView web;
    private TextView address;
    private Button sizeButton;
    private PluginCall pendingLoad;
    private Runnable pendingTimeout;
    private boolean loading = false;
    private boolean large = false;

    private int panelHeight() {
        int height = getActivity().getWindow().getDecorView().getHeight();
        if (height <= 0) height = getActivity().getResources().getDisplayMetrics().heightPixels;
        return Math.round(height * (large ? 0.92f : 0.55f));
    }

    private void layoutPanel() {
        if (panel == null) return;
        ViewGroup.LayoutParams params = panel.getLayoutParams();
        params.height = panelHeight();
        panel.setLayoutParams(params);
    }

    /** Must run on the UI thread. */
    private void ensure() {
        if (web != null) return;
        Activity activity = getActivity();
        float density = activity.getResources().getDisplayMetrics().density;

        panel = new LinearLayout(activity);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(Color.WHITE);
        panel.setElevation(24 * density);

        LinearLayout bar = new LinearLayout(activity);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#F4F1EA"));
        int pad = Math.round(8 * density);
        bar.setPadding(pad * 2, pad, pad, pad);

        address = new TextView(activity);
        address.setSingleLine(true);
        address.setEllipsize(TextUtils.TruncateAt.END);
        address.setTextSize(12);
        address.setTextColor(Color.parseColor("#3A3A3A"));
        address.setTypeface(Typeface.DEFAULT_BOLD);
        address.setText("Glow browser");
        bar.addView(address, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        sizeButton = new Button(activity);
        sizeButton.setText("Bigger");
        sizeButton.setAllCaps(false);
        sizeButton.setOnClickListener(v -> {
            large = !large;
            sizeButton.setText(large ? "Smaller" : "Bigger");
            layoutPanel();
        });
        bar.addView(sizeButton);

        Button hide = new Button(activity);
        hide.setText("Hide");
        hide.setAllCaps(false);
        hide.setOnClickListener(v -> {
            panel.setVisibility(View.GONE);
            notifyListeners("hidden", new JSObject());
        });
        bar.addView(hide);

        web = new WebView(activity);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                return !("http".equals(scheme) || "https".equals(scheme)); // block intent:, file:, javascript: ...
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                loading = true;
                address.setText(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                loading = false;
                String title = view.getTitle();
                address.setText(title == null || title.isEmpty() ? url : title);
                finishLoad(null);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    loading = false;
                    finishLoad("The page could not be opened: " + error.getDescription());
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient());

        panel.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        ViewCompat.setOnApplyWindowInsetsListener(panel, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(0, bars.top, 0, 0);
            return insets;
        });

        FrameLayout content = activity.findViewById(android.R.id.content);
        content.addView(panel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, panelHeight(), Gravity.TOP));
        web.loadUrl("about:blank");
    }

    private JSObject state() {
        JSObject result = new JSObject();
        String url = web == null ? "about:blank" : web.getUrl();
        String title = web == null ? "" : web.getTitle();
        result.put("url", url == null ? "about:blank" : url);
        result.put("title", title == null ? "" : title);
        result.put("loading", loading);
        result.put("visible", panel != null && panel.getVisibility() == View.VISIBLE);
        return result;
    }

    private void finishLoad(String error) {
        if (pendingLoad == null) return;
        if (pendingTimeout != null) main.removeCallbacks(pendingTimeout);
        JSObject result = state();
        if (error != null) result.put("error", error);
        PluginCall call = pendingLoad;
        pendingLoad = null;
        pendingTimeout = null;
        call.resolve(result);
    }

    private void waitForLoad(PluginCall call) {
        if (pendingLoad != null) finishLoad("Another page started loading.");
        pendingLoad = call;
        pendingTimeout = () -> {
            loading = false;
            finishLoad(null); // slow page: carry on with whatever has loaded
        };
        main.postDelayed(pendingTimeout, LOAD_TIMEOUT_MS);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url", "");
        Uri parsed = Uri.parse(url);
        if (!"http".equals(parsed.getScheme()) && !"https".equals(parsed.getScheme())) {
            call.reject("Only http and https pages can be opened.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            ensure();
            panel.setVisibility(View.VISIBLE);
            waitForLoad(call);
            web.loadUrl(url);
        });
    }

    @PluginMethod
    public void evaluate(PluginCall call) {
        String script = call.getString("script", "");
        getActivity().runOnUiThread(() -> {
            ensure();
            web.evaluateJavascript(script, value -> {
                JSObject result = new JSObject();
                result.put("value", value);
                call.resolve(result);
            });
        });
    }

    @PluginMethod
    public void back(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            ensure();
            if (web.canGoBack()) {
                waitForLoad(call);
                web.goBack();
            } else {
                call.resolve(state());
            }
        });
    }

    @PluginMethod
    public void state(PluginCall call) {
        getActivity().runOnUiThread(() -> call.resolve(state()));
    }

    @PluginMethod
    public void show(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            ensure();
            panel.setVisibility(View.VISIBLE);
            call.resolve(state());
        });
    }

    @PluginMethod
    public void hide(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (panel != null) panel.setVisibility(View.GONE);
            call.resolve(state());
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (pendingLoad != null) finishLoad("The browser was closed.");
            if (panel != null) {
                ((ViewGroup) panel.getParent()).removeView(panel);
                web.destroy();
            }
            panel = null;
            web = null;
            loading = false;
            call.resolve(new JSObject());
        });
    }
}
