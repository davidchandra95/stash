package local.stash.platform

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.view.WindowManager
import android.view.View
import android.view.inputmethod.InputMethodManager
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.content.Intent
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg class CredentialArgs { lateinit var device: String; var token: String = "" }
@InvokeArg class AppearanceArgs { var dark: Boolean = true; var background: String = "#222620" }
@InvokeArg class UrlArgs { lateinit var url: String }
@InvokeArg class KeyboardArgs { var visible: Boolean = false }

@TauriPlugin
class StashPlatformPlugin(private val activity: Activity): Plugin(activity) {
    private external fun initTls(context: Context)
    private var webView: WebView? = null
    override fun load(webView: WebView) {
        this.webView = webView
        initTls(activity.applicationContext)
        // Resize the WebView ourselves, including on older Android System WebViews.
        // Zero the consumed insets so newer WebViews do not apply them a second time.
        activity.window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING)
        val container = activity.findViewById<View>(android.R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
            val safe = insets.getInsets(types)
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            trigger("keyboard", JSObject().put("visible", insets.isVisible(WindowInsetsCompat.Type.ime())))
            WindowInsetsCompat.Builder(insets).setInsets(types, Insets.NONE).build()
        }
        ViewCompat.requestApplyInsets(container)
    }
    @Command fun keyboard(invoke: Invoke) {
        val args = invoke.parseArgs(KeyboardArgs::class.java)
        val manager = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        webView?.let { view ->
            if (args.visible) view.post { manager.showSoftInput(view, InputMethodManager.SHOW_IMPLICIT) }
            else manager.hideSoftInputFromWindow(view.windowToken, 0)
        }
        invoke.resolve()
    }
    @Command fun appearance(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(AppearanceArgs::class.java)
            val controller = WindowInsetsControllerCompat(activity.window, activity.window.decorView)
            controller.isAppearanceLightStatusBars = !args.dark
            controller.isAppearanceLightNavigationBars = !args.dark
            // CSS supplies rgb(r, g, b) or a hexadecimal palette color.
            val numbers = Regex("[0-9]+").findAll(args.background).map { it.value.toInt() }.toList()
            val color = if (args.background.startsWith("rgb") && numbers.size >= 3) Color.rgb(numbers[0], numbers[1], numbers[2]) else Color.parseColor(args.background)
            activity.window.decorView.setBackgroundColor(color)
            webView?.setBackgroundColor(color)
            invoke.resolve()
        } catch (e: Exception) { invoke.reject("Could not update system appearance") }
    }
    override fun onPause() { trigger("lifecycle", JSObject().put("state", "paused")) }
    override fun onResume() { trigger("lifecycle", JSObject().put("state", "resumed")) }

    private fun alias(device: String): String {
        require(Regex("[a-zA-Z0-9_-]{1,128}").matches(device))
        return "stash.sync.$device"
    }
    private fun file(device: String) = AtomicFile(File(activity.noBackupFilesDir, "${alias(device)}.enc"))
    private fun key(device: String, create: Boolean): SecretKey {
        val name = alias(device)
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(name, null) as? SecretKey)?.let { return it }
        check(create) { "Missing credential key" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(name, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
        }.generateKey()
    }
    @Command fun saveToken(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(CredentialArgs::class.java)
            require(Regex("[a-fA-F0-9]{64}").matches(args.token))
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key(args.device, true))
            cipher.updateAAD(alias(args.device).toByteArray(Charsets.UTF_8))
            val bytes = cipher.doFinal(args.token.toByteArray(Charsets.UTF_8))
            val encoded = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(bytes, Base64.NO_WRAP)
            val target = file(args.device)
            val stream = target.startWrite()
            try { stream.write(encoded.toByteArray(Charsets.UTF_8)); target.finishWrite(stream) }
            catch (e: Exception) { target.failWrite(stream); throw e }
            invoke.resolve()
        } catch (e: Exception) { invoke.reject("Could not securely save device credentials") }
    }
    @Command fun loadToken(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(CredentialArgs::class.java)
            val pieces = String(file(args.device).readFully(), Charsets.UTF_8).split(":")
            require(pieces.size == 2)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(args.device, false), GCMParameterSpec(128, Base64.decode(pieces[0], Base64.NO_WRAP)))
            cipher.updateAAD(alias(args.device).toByteArray(Charsets.UTF_8))
            val token = String(cipher.doFinal(Base64.decode(pieces[1], Base64.NO_WRAP)), Charsets.UTF_8)
            require(Regex("[a-fA-F0-9]{64}").matches(token))
            invoke.resolve(JSObject().put("token", token))
        } catch (e: Exception) { invoke.reject("Saved credentials are unavailable. Reconnect in Sync settings.") }
    }
    @Command fun background(invoke: Invoke) {
        activity.moveTaskToBack(true)
        invoke.resolve()
    }
    @Command fun openUrl(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(UrlArgs::class.java)
            val uri = Uri.parse(args.url)
            require(uri.scheme in listOf("https", "http", "mailto"))
            activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
            invoke.resolve()
        } catch (e: Exception) { invoke.reject("No app could open this link") }
    }
}
