
// MARK: - Guang Yao Together: new-window support (appended to AppDelegate.swift by scripts/prepare-native.mjs)
import WebKit

/// Shows the live site like Capacitor's default controller, but lets the Puter sign-in window open inside the app
/// (so it can postMessage back to the page) while other new-window links open in Safari.
class GuangYaoViewController: CAPBridgeViewController {
    private var windowDelegate: GuangYaoWindowDelegate?

    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let webView = webView else { return }
        let delegate = GuangYaoWindowDelegate(original: webView.uiDelegate, host: self)
        windowDelegate = delegate
        webView.uiDelegate = delegate
    }
}

final class GuangYaoWindowDelegate: NSObject, WKUIDelegate {
    private weak var original: WKUIDelegate?
    private weak var host: CAPBridgeViewController?
    private var signInView: WKWebView?

    init(original: WKUIDelegate?, host: CAPBridgeViewController) {
        self.original = original
        self.host = host
    }

    // Everything we do not implement (alerts, confirms, prompts) keeps going to Capacitor's own delegate.
    override func responds(to aSelector: Selector!) -> Bool {
        return super.responds(to: aSelector) || (original?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        return original
    }

    private static func isSignIn(_ url: URL?) -> Bool {
        guard let url = url else { return true }
        if url.scheme == "about" { return true }
        guard let host = url.host?.lowercased() else { return false }
        return host == "puter.com" || host.hasSuffix(".puter.com")
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let url = navigationAction.request.url
        guard GuangYaoWindowDelegate.isSignIn(url) else {
            if let url = url {
                UIApplication.shared.open(url)
            }
            return nil
        }
        let child = WKWebView(frame: .zero, configuration: configuration)
        child.customUserAgent = webView.customUserAgent
        child.uiDelegate = self
        signInView = child
        let controller = UIViewController()
        controller.title = "登入 Puter 帳號"
        controller.view = child
        controller.navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(closeSignIn))
        let navigation = UINavigationController(rootViewController: controller)
        navigation.modalPresentationStyle = .fullScreen
        host?.present(navigation, animated: true)
        return child
    }

    func webViewDidClose(_ webView: WKWebView) {
        if webView === signInView {
            closeSignIn()
        }
    }

    @objc private func closeSignIn() {
        signInView = nil
        host?.presentedViewController?.dismiss(animated: true) { [weak self] in
            self?.host?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('guangyao:native-window-closed'))")
        }
    }
}
