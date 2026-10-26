package io.github.juw12.guangyao;

import android.annotation.SuppressLint;
import android.app.Dialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Guang Yao Together shell. The app shows the live site; this activity adds what a plain WebView lacks:
 * window.open() support so the Puter sign-in window can talk back to the page (postMessage via window.opener),
 * shown in a full-screen dialog, while every other new-window link (PDFs, YouTube, sign-up forms) opens in the
 * phone's browser.
 */
public class MainActivity extends BridgeActivity {
    private Dialog signInDialog;
    private WebView signInView;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setWebChromeClient(new WindowAwareChromeClient());
    }

    static boolean isSignInHost(String host) {
        if (host == null) {
            return false;
        }
        String value = host.toLowerCase();
        return value.equals("puter.com") || value.endsWith(".puter.com");
    }

    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "找不到可以開啟這個連結的 App。", Toast.LENGTH_LONG).show();
        }
    }

    private void showSignIn(WebView child) {
        if (signInDialog != null && signInView == child) {
            return;
        }
        Dialog dialog = new Dialog(this, android.R.style.Theme_DeviceDefault_Light_NoActionBar);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setFitsSystemWindows(true);
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.rgb(24, 62, 60));
        bar.setPadding(36, 12, 12, 12);
        TextView title = new TextView(this);
        title.setText("登入 Puter 帳號");
        title.setTextColor(Color.WHITE);
        title.setTextSize(17);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button close = new Button(this);
        close.setText("關閉");
        close.setOnClickListener(view -> dialog.dismiss());
        bar.addView(close);
        layout.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        if (child.getParent() instanceof ViewGroup) {
            ((ViewGroup) child.getParent()).removeView(child);
        }
        layout.addView(child, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        dialog.setContentView(layout);
        dialog.setOnKeyListener((d, keyCode, event) -> {
            if (keyCode == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_UP && child.canGoBack()) {
                child.goBack();
                return true;
            }
            return false;
        });
        dialog.setOnDismissListener(d -> {
            child.destroy();
            if (signInView == child) {
                signInView = null;
                signInDialog = null;
            }
            // Lets the page reset its "signing in" state if the window was closed without finishing.
            getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new CustomEvent('guangyao:native-window-closed'))", null);
        });
        signInDialog = dialog;
        signInView = child;
        dialog.show();
    }

    private void closeWindow(WebView window) {
        if (signInDialog != null && signInView == window) {
            signInDialog.dismiss();
        } else {
            window.destroy();
        }
    }

    private class WindowAwareChromeClient extends BridgeWebChromeClient {
        WindowAwareChromeClient() {
            super(getBridge());
        }

        @SuppressLint("SetJavaScriptEnabled")
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            WebView child = new WebView(MainActivity.this);
            WebSettings childSettings = child.getSettings();
            childSettings.setJavaScriptEnabled(true);
            childSettings.setDomStorageEnabled(true);
            childSettings.setUserAgentString(view.getSettings().getUserAgentString());
            CookieManager.getInstance().setAcceptThirdPartyCookies(child, true);
            child.setWebViewClient(new NewWindowRouter());
            child.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onCloseWindow(WebView window) {
                    closeWindow(window);
                }
            });
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(child);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public void onCloseWindow(WebView window) {
            closeWindow(window);
        }
    }

    /** Decides on the first real URL of a new window: Puter sign-in stays in the app, anything else goes to the browser. */
    private class NewWindowRouter extends WebViewClient {
        private boolean keepInApp = false;
        private boolean handedOff = false;

        private boolean route(WebView view, Uri uri) {
            if (keepInApp || uri == null) {
                return false;
            }
            String scheme = uri.getScheme();
            if (scheme == null || scheme.equals("about") || scheme.equals("blob") || scheme.equals("data")) {
                return false;
            }
            if (isSignInHost(uri.getHost())) {
                keepInApp = true;
                showSignIn(view);
                return false;
            }
            view.stopLoading();
            if (!handedOff) {
                handedOff = true;
                openExternally(uri);
                view.post(view::destroy);
            }
            return true;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return route(view, request.getUrl());
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            route(view, Uri.parse(url));
            super.onPageStarted(view, url, favicon);
        }
    }
}
