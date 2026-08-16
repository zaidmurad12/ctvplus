package com.cinemana.tv

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.*
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import java.io.InputStream

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private lateinit var fullscreenContainer: FrameLayout
    private var fallbackToFileAssetAttempted = false

    // Domain & Asset URIs for maximum Android TV & Emulator compatibility
    private val fileAssetUrl = "file:///android_asset/index.html"
    private val appAssetsUrl = "https://appassets.androidplatform.net/index.html"
    private val liveServerUrl = "https://ais-dev-y5ulc2o3n7cireamjvyi3x-460709864021.europe-west3.run.app"
    private val localServerUrl = "http://10.0.2.2:3001" // For Android Emulator
    // For physical device, use: "http://<YOUR_PC_IP>:3000" (e.g., "http://192.168.1.100:3000")

    private fun handleLocalAssetRequest(uri: Uri): WebResourceResponse? {
        var path = uri.path?.trimStart('/') ?: ""
        if (path.startsWith("android_asset/")) {
            path = path.removePrefix("android_asset/")
        }
        val finalPath = if (path.isEmpty() || path == "/") "index.html" else path
        return try {
            val inputStream: InputStream = try {
                assets.open(finalPath)
            } catch (e: Exception) {
                if (finalPath.startsWith("assets/")) {
                    try {
                        assets.open(finalPath.removePrefix("assets/"))
                    } catch (_: Exception) {
                        throw e
                    }
                } else {
                    try {
                        assets.open("assets/$finalPath")
                    } catch (_: Exception) {
                        throw e
                    }
                }
            }
            val mimeType = getMimeType(finalPath)
            val headers = mapOf(
                "Access-Control-Allow-Origin" to "*",
                "Access-Control-Allow-Methods" to "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers" to "*"
            )
            // Note: encoding must be null for uncompressed streams; passing "UTF-8" as Content-Encoding causes ERR_CONTENT_DECODING_FAILED in Chromium.
            WebResourceResponse(mimeType, null, 200, "OK", headers, inputStream)
        } catch (e: Exception) {
            android.util.Log.e("CinemanaTV", "Failed to open asset: $finalPath - ${e.message}")
            // SPA fallback ONLY for HTML routes (not for assets/ or api/)
            if (!finalPath.contains(".") && !finalPath.startsWith("assets/") && !finalPath.startsWith("api/")) {
                try {
                    val inputStream: InputStream = assets.open("index.html")
                    return WebResourceResponse("text/html", null, 200, "OK", null, inputStream)
                } catch (_: Exception) {}
            }
            null
        }
    }

    private fun getMimeType(filePath: String): String {
        val lower = filePath.lowercase()
        return when {
            lower.endsWith(".html") || lower.endsWith(".htm") -> "text/html"
            lower.endsWith(".js") || lower.endsWith(".mjs") -> "text/javascript"
            lower.endsWith(".css") -> "text/css"
            lower.endsWith(".json") -> "application/json"
            lower.endsWith(".svg") -> "image/svg+xml"
            lower.endsWith(".png") -> "image/png"
            lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
            lower.endsWith(".gif") -> "image/gif"
            lower.endsWith(".webp") -> "image/webp"
            lower.endsWith(".ico") -> "image/x-icon"
            lower.endsWith(".ttf") -> "font/ttf"
            lower.endsWith(".woff") -> "font/woff"
            lower.endsWith(".woff2") -> "font/woff2"
            lower.endsWith(".m3u8") -> "application/x-mpegURL"
            lower.endsWith(".ts") -> "video/MP2T"
            lower.endsWith(".mp4") -> "video/mp4"
            lower.endsWith(".vtt") -> "text/vtt"
            lower.endsWith(".srt") -> "text/plain"
            else -> "application/octet-stream"
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Fullscreen and Keep Screen On during video playback for TV experience
        window.setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        )
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        fullscreenContainer = FrameLayout(this)
        fullscreenContainer.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        fullscreenContainer.setBackgroundColor(Color.BLACK)

        webView = WebView(this)
        webView.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        webView.setBackgroundColor(Color.parseColor("#090b11")) // Cinemana TV dark theme

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = false
            loadWithOverviewMode = false
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = true
            defaultTextEncodingName = "UTF-8"

            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            }

            userAgentString = "Mozilla/5.0 (Linux; Android 10; SmartTV; CinemanaTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36 SmartTV CinemanaTV/1.0"
        }
        webView.setInitialScale(100)

        // NOTE: Forcing LAYER_TYPE_HARDWARE creates an off-screen GPU texture that some
        // Android TV box GPU drivers (common on budget/no-name boxes) fail to composite,
        // resulting in a black screen even though the page loaded fine. LAYER_TYPE_NONE lets
        // the window-level hardwareAccelerated="true" flag handle acceleration normally.
        webView.setLayerType(View.LAYER_TYPE_NONE, null)

        // Focusability for Android TV D-Pad navigation
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.requestFocus()

        // Configure WebViewAssetLoader for domain appassets.androidplatform.net
        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.webViewClient = object : WebViewClient() {

            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                if (request != null && request.url != null) {
                    val uri = request.url
                    val host = uri.host ?: ""
                    val urlStr = uri.toString()

                    if (host == "appassets.androidplatform.net") {
                        val loadedResponse = assetLoader.shouldInterceptRequest(uri)
                        if (loadedResponse != null) return loadedResponse
                    }

                    if (host == "appassets.androidplatform.net" || urlStr.startsWith("file:///android_asset/")) {
                        val response = handleLocalAssetRequest(uri)
                        if (response != null) return response
                    }
                }
                return super.shouldInterceptRequest(view, request)
            }

            @Suppress("DEPRECATION")
            override fun shouldInterceptRequest(
                view: WebView?,
                url: String?
            ): WebResourceResponse? {
                if (url != null) {
                    val uri = Uri.parse(url)
                    val host = uri.host ?: ""
                    if (host == "appassets.androidplatform.net") {
                        val loadedResponse = assetLoader.shouldInterceptRequest(uri)
                        if (loadedResponse != null) return loadedResponse
                    }

                    if (host == "appassets.androidplatform.net" || url.startsWith("file:///android_asset/")) {
                        val response = handleLocalAssetRequest(uri)
                        if (response != null) return response
                    }
                }
                return super.shouldInterceptRequest(view, url)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false // Keep all navigation inside the WebView
            }

            @SuppressLint("WebViewClientOnReceivedSslError")
            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                handler?.proceed() // Allow self-signed or HTTP/HTTPS stream redirects
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    val failingUrl = request.url.toString()
                    android.util.Log.e("CinemanaTV", "WebView main frame error: ${error?.description} on $failingUrl")
                    if (failingUrl.contains("appassets.androidplatform.net") && !fallbackToFileAssetAttempted) {
                        fallbackToFileAssetAttempted = true
                        view?.loadUrl(fileAssetUrl)
                    } else {
                        showOfflineErrorPage(view)
                    }
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                if (consoleMessage != null) {
                    android.util.Log.d("CinemanaTV_JS", "${consoleMessage.message()} -- From line ${consoleMessage.lineNumber()} of ${consoleMessage.sourceId()}")
                }
                return true
            }

            // HTML5 Native Video Fullscreen for Android TV
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                super.onShowCustomView(view, callback)
                if (customView != null) {
                    callback?.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                webView.visibility = View.GONE
                fullscreenContainer.addView(customView)
                fullscreenContainer.visibility = View.VISIBLE
            }

            override fun onHideCustomView() {
                super.onHideCustomView()
                if (customView == null) return
                fullscreenContainer.removeView(customView)
                customView = null
                customViewCallback?.onCustomViewHidden()
                fullscreenContainer.visibility = View.GONE
                webView.visibility = View.VISIBLE
            }
        }

        fullscreenContainer.addView(webView)
        setContentView(fullscreenContainer)

        // Load local app assets via WebViewAssetLoader domain for full Web API, LocalStorage & HTTPS origin support
        // Change this to localServerUrl to connect to a local development server
        // webView.loadUrl(appAssetsUrl)
        webView.loadUrl(localServerUrl) // Using local dev server (http://10.0.2.2:3000)
    }

    private fun showOfflineErrorPage(view: WebView?) {
        val errorHtml = """
            <!DOCTYPE html>
            <html dir="rtl" lang="ar">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>سينمانا TV</title>
                <style>
                    body {
                        background-color: #090b11;
                        color: #ffffff;
                        font-family: system-ui, -apple-system, sans-serif;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                        text-align: center;
                    }
                    .logo {
                        font-size: 36px;
                        font-weight: bold;
                        color: #ef4444;
                        margin-bottom: 24px;
                        letter-spacing: 1px;
                    }
                    .title {
                        font-size: 24px;
                        margin-bottom: 12px;
                    }
                    .desc {
                        font-size: 16px;
                        color: #9ca3af;
                        margin-bottom: 32px;
                        max-width: 400px;
                        line-height: 1.6;
                    }
                    .btn {
                        background-color: #ef4444;
                        color: #ffffff;
                        border: none;
                        padding: 14px 36px;
                        font-size: 18px;
                        font-weight: bold;
                        border-radius: 8px;
                        cursor: pointer;
                        outline: none;
                        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
                        transition: all 0.2s;
                    }
                    .btn:focus, .btn:hover {
                        background-color: #dc2626;
                        transform: scale(1.08);
                        box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.6);
                    }
                </style>
            </head>
            <body>
                <div class="logo">🎬 CINEMANA TV</div>
                <div class="title">تعذر تحميل التطبيق</div>
                <div class="desc">يرجى التأكد من اتصال الجهاز بالشبكة ثم اضغط إعادة المحاولة.</div>
                <button class="btn" id="retryBtn" onclick="window.location.href='file:///android_asset/index.html'">إعادة المحاولة</button>
                <script>
                    document.getElementById('retryBtn').focus();
                </script>
            </body>
            </html>
        """.trimIndent()

        view?.loadDataWithBaseURL("file:///android_asset/", errorHtml, "text/html", "UTF-8", null)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (customView != null) {
            if (keyCode == KeyEvent.KEYCODE_BACK) {
                webView.webChromeClient?.onHideCustomView()
                return true
            }
            return super.onKeyDown(keyCode, event)
        }

        if (keyCode == KeyEvent.KEYCODE_BACK) {
            webView.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ESCAPE))
            webView.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ESCAPE))

            if (!webView.canGoBack()) {
                finish()
            } else {
                webView.goBack()
            }
            return true
        }

        return super.onKeyDown(keyCode, event)
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        super.onDestroy()
        webView.destroy()
    }
}
