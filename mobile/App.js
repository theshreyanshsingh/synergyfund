import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, Alert, AppState, BackHandler, KeyboardAvoidingView, Linking, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"
import { StatusBar } from "expo-status-bar"
import * as SplashScreen from "expo-splash-screen"
import Constants from "expo-constants"
import { WebView } from "react-native-webview"
import { APP_ORIGIN, APP_URL, isAppPage } from "./src/config"
import { downloadAndShare } from "./src/downloads"
import { pathFromLink, phone, registerScript, signedOutPage, visibilityScript } from "./src/phone"

SplashScreen.preventAutoHideAsync()
SplashScreen.setOptions({ duration: 250, fade: true })

const VERSION = Constants.expoConfig?.version || "1.0.0"

// Tells the website it is inside the app before any of its code runs (downloads come to the app, install prompts hide).
const BEFORE_LOAD = `window.SynergiFundNative = ${JSON.stringify({ platform: Platform.OS, version: VERSION })}; true;`

// Reports the page's background color, so the area behind the phone's clock and home bar matches the light or dark theme.
const AFTER_LOAD = `(function () {
  function send() {
    var body = document.body;
    if (!body || !window.ReactNativeWebView) return;
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "theme", background: getComputedStyle(body).backgroundColor, dark: dark }));
  }
  send();
  new MutationObserver(send).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
})(); true;`

// For a file the page opened directly: ask the website for a short-lived link the app can download.
function linkRequest(url) {
  return `(function () {
    var target = new URL(${JSON.stringify(url)}, location.href);
    fetch("/api/documents/download-link", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: target.pathname.replace(/^\\/api/, "") + target.search }) })
      .then(function (response) { return response.json(); })
      .then(function (data) { if (data.path) window.ReactNativeWebView.postMessage(JSON.stringify({ type: "download", url: location.origin + "/api" + data.path, name: "" })); });
  })(); true;`
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  )
}

function Shell() {
  const web = useRef(null)
  const scheme = useColorScheme()
  const [theme, setTheme] = useState(() => ({ background: scheme === "dark" ? "#101114" : "#f3f4f6", dark: scheme === "dark" }))
  const [failed, setFailed] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [download, setDownload] = useState(null)
  const canGoBack = useRef(false)
  // The first page: the app's start page, or the page a notification or Answer opened the app on.
  const [start, setStart] = useState("")
  // The phone registers for calls and messages once per page load, when someone is signed in.
  const needsRegister = useRef(true)
  const asked = useRef(false)

  useEffect(() => {
    let done = false
    const open = (url) => {
      if (done) return
      done = true
      const path = pathFromLink(url)
      setStart(path ? `${APP_ORIGIN}${path}` : APP_URL)
    }
    Linking.getInitialURL().then(open).catch(() => open(""))
    const timer = setTimeout(() => open(""), 1500)
    // A notification or Answer while the app is already open: go to that page.
    const subscription = Linking.addEventListener("url", ({ url }) => {
      const path = pathFromLink(url)
      if (path) web.current?.injectJavaScript(`location.href = ${JSON.stringify(`${APP_ORIGIN}${path}`)}; true;`)
    })
    return () => {
      clearTimeout(timer)
      subscription.remove()
    }
  }, [])

  // Background and back: the page counts as away while the app is in the background.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      web.current?.injectJavaScript(visibilityScript(next !== "active"))
    })
    return () => subscription.remove()
  }, [])

  // A new push address registers again. (Hang up and Decline reach the page from the native side directly.)
  useEffect(() => {
    if (!phone) return undefined
    const token = phone.addListener("onToken", () => {
      needsRegister.current = true
      register()
    })
    return () => token.remove()
    // register reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function register(url) {
    if (!phone || !phone.isPushReady() || !needsRegister.current || signedOutPage(url)) return
    needsRegister.current = false
    const token = await phone.getPushToken().catch(() => null)
    if (token) web.current?.injectJavaScript(registerScript(token))
    else needsRegister.current = true
  }

  // After the first registration: notifications allowed (Android 13+), and calls allowed over the lock screen (14+).
  async function askOnce() {
    if (asked.current || !phone) return
    asked.current = true
    if (Platform.OS === "android" && Platform.Version >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {})
    }
    if (!phone.canUseFullScreen()) {
      Alert.alert("Show calls on the lock screen", "Allow SynergiFund to show incoming calls over the lock screen, like a phone call.", [
        { text: "Not now", style: "cancel" },
        { text: "Allow", onPress: () => phone.openFullScreenSettings() },
      ])
    }
  }

  // Android's back button goes back a page, like a browser, before leaving the app.
  useEffect(() => {
    if (Platform.OS !== "android") return undefined
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack.current) return false
      web.current?.goBack()
      return true
    })
    return () => subscription.remove()
  }, [])

  const openOutside = useCallback((url) => {
    Linking.openURL(url).catch(() => {})
  }, [])

  // Pages of the website stay in the app; mail, phone, maps, email drafts and listing sites open in their own apps.
  function onShouldStartLoadWithRequest(request) {
    const url = request.url || ""
    if (!url || /^(about|data|blob):/i.test(url)) return true
    if (request.isTopFrame === false) return true
    if (isAppPage(url)) return true
    openOutside(url)
    return false
  }

  function onOpenWindow(event) {
    const url = event.nativeEvent.targetUrl || ""
    if (isAppPage(url)) web.current?.injectJavaScript(`location.href = ${JSON.stringify(url)}; true;`)
    else if (url) openOutside(url)
  }

  async function onMessage(event) {
    let data
    try {
      data = JSON.parse(event.nativeEvent.data)
    } catch {
      return
    }
    if (data.type === "theme" && data.background) setTheme({ background: data.background, dark: Boolean(data.dark) })
    if (data.type === "push-registered" && phone && data.deviceKey) {
      phone.configure(APP_ORIGIN, data.deviceKey)
      askOnce()
    }
    // A call started or ended on the page: keep it going with the screen off, with Hang up in the notification.
    if (data.type === "call-state" && phone) {
      if (data.active) phone.startCall(String(data.title || "SynergiFund call"), String(data.body || "Ongoing call"), Boolean(data.video))
      else phone.endCall()
    }
    // The page heard a ring (or its end) over its open connection: ring the phone now, before the push arrives.
    if (data.type === "call-ring" && phone && data.callId) {
      phone.showPush({ type: "call", callId: String(data.callId), title: String(data.title || "Incoming call"), body: String(data.body || ""), media: String(data.media || "audio"), caller: String(data.caller || ""), sentAt: String(Date.now()), ringFor: "45000" })
    }
    if (data.type === "call-ring-stop" && phone && data.callId) phone.showPush({ type: "call-over", callId: String(data.callId), quiet: "true" })
    if (data.type === "signed-out" && phone) {
      phone.forget()
      phone.endCall()
      needsRegister.current = true
    }
    if (data.type === "open-settings") Linking.openSettings().catch(() => {})
    if (data.type === "download" && isAppPage(data.url)) {
      const name = data.name || ""
      setDownload({ name, progress: null, error: "" })
      try {
        await downloadAndShare(data.url, name, (progress) => setDownload((current) => (current && !current.error ? { ...current, progress } : current)))
        setDownload(null)
      } catch (error) {
        setDownload({ name, progress: null, error: error?.message || "The file could not be downloaded." })
      }
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      {/* Android draws edge to edge, so the keyboard covers the page instead of shrinking it: make room for it, or the
          chat box and other fields at the bottom would sit under the keyboard. The iPhone's web view does this itself. */}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "android" ? "padding" : undefined} enabled={Platform.OS === "android"}>
        {!start ? (
          <Loading background={theme.background} dark={theme.dark} />
        ) : failed ? (
          <Offline message={failed} dark={theme.dark} onRetry={() => { setFailed(""); setAttempt((value) => value + 1) }} />
        ) : (
          <WebView
            key={attempt}
            ref={web}
            source={{ uri: start }}
            style={{ backgroundColor: theme.background }}
            originWhitelist={["*"]}
            injectedJavaScriptBeforeContentLoaded={BEFORE_LOAD}
            injectedJavaScript={AFTER_LOAD}
            onMessage={onMessage}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            onOpenWindow={onOpenWindow}
            onLoadStart={() => { needsRegister.current = true }}
          onNavigationStateChange={(state) => {
            canGoBack.current = state.canGoBack
            if (signedOutPage(state.url)) needsRegister.current = true
            else register(state.url)
          }}
            onFileDownload={(event) => {
              const url = event.nativeEvent.downloadUrl || ""
              if (url.toLowerCase().startsWith(`${APP_ORIGIN}/api/`)) web.current?.injectJavaScript(linkRequest(url))
            }}
            onLoadEnd={() => SplashScreen.hide()}
            onError={(event) => {
              SplashScreen.hide()
              setFailed(event.nativeEvent.description || "SynergiFund could not be reached.")
            }}
            // iOS can close a page that sits in the background for a long time; open it again when that happens.
            onContentProcessDidTerminate={() => web.current?.reload()}
            onRenderProcessGone={() => web.current?.reload()}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            domStorageEnabled
            javaScriptEnabled
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
            allowsLinkPreview={false}
            applicationNameForUserAgent={`SynergiFundApp/${VERSION}`}
            webviewDebuggingEnabled={__DEV__}
            startInLoadingState
            renderLoading={() => <Loading background={theme.background} dark={theme.dark} />}
            allowsFullscreenVideo
          />
        )}
      </KeyboardAvoidingView>
      {download && <DownloadBar download={download} dark={theme.dark} onClose={() => setDownload(null)} />}
    </SafeAreaView>
  )
}

function Loading({ background, dark }) {
  return (
    <View style={[styles.fill, styles.center, { backgroundColor: background }]}>
      <ActivityIndicator color={dark ? "#f4f4f5" : "#111827"} />
    </View>
  )
}

function Offline({ message, dark, onRetry }) {
  const text = dark ? "#f4f4f5" : "#111827"
  return (
    <View style={[styles.fill, styles.center, styles.padded]}>
      <Text style={[styles.title, { color: text }]}>Can't reach SynergiFund</Text>
      <Text style={[styles.body, { color: dark ? "#a1a1aa" : "#6b7280" }]}>Check your connection, then try again.</Text>
      <Text style={[styles.detail, { color: dark ? "#71717a" : "#9ca3af" }]}>{message}</Text>
      <Pressable style={[styles.button, { backgroundColor: text }]} onPress={onRetry} accessibilityRole="button">
        <Text style={[styles.buttonText, { color: dark ? "#111214" : "#ffffff" }]}>Try Again</Text>
      </Pressable>
    </View>
  )
}

function DownloadBar({ download, dark, onClose }) {
  const { name, progress, error } = download
  return (
    <View style={[styles.download, { backgroundColor: dark ? "#1c1f26" : "#ffffff", borderColor: dark ? "#2c3038" : "#e6e7eb" }]}>
      {error ? null : <ActivityIndicator color={dark ? "#f4f4f5" : "#111827"} />}
      <View style={styles.downloadCopy}>
        <Text numberOfLines={1} style={[styles.downloadName, { color: dark ? "#f4f4f5" : "#111827" }]}>{name || (error ? "Download failed" : "Downloading")}</Text>
        <Text numberOfLines={2} style={[styles.downloadState, { color: error ? "#dc2626" : dark ? "#a1a1aa" : "#6b7280" }]}>
          {error || (progress == null ? "Downloading…" : `Downloading… ${Math.round(progress * 100)}%`)}
        </Text>
      </View>
      {error ? (
        <Pressable onPress={onClose} accessibilityRole="button" hitSlop={10}>
          <Text style={[styles.downloadClose, { color: dark ? "#f4f4f5" : "#111827" }]}>Close</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  padded: { padding: 32 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 6, textAlign: "center" },
  body: { fontSize: 15, textAlign: "center" },
  detail: { fontSize: 12, marginTop: 8, textAlign: "center" },
  button: { marginTop: 20, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 10 },
  buttonText: { fontSize: 15, fontWeight: "700" },
  download: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  downloadCopy: { flex: 1 },
  downloadName: { fontSize: 14, fontWeight: "700" },
  downloadState: { fontSize: 12, marginTop: 2 },
  downloadClose: { fontSize: 14, fontWeight: "700" },
})
