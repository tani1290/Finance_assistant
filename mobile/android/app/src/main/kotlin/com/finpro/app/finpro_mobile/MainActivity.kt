package com.finpro.app.finpro_mobile

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.annotation.NonNull
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import org.json.JSONArray
import java.io.File

class MainActivity : FlutterActivity() {

    private val SMS_CHANNEL = "com.finpro.app/sms_channel"
    private val PLATFORM_CHANNEL = "com.finpro.app/platform"
    private val PERMISSION_REQUEST_CODE = 44101
    private var pendingResult: MethodChannel.Result? = null
    private var smsChannel: MethodChannel? = null

    override fun configureFlutterEngine(@NonNull flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // Only RECEIVE_SMS is required: the receiver handles incoming messages
        // as they arrive. FinPro deliberately does not request READ_SMS or scan
        // the historical inbox.
        smsChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, SMS_CHANNEL)
        smsChannel?.setMethodCallHandler { call, result ->
            when (call.method) {
                "checkSmsPermission" -> {
                    result.success(hasReceiveSmsPermission())
                }
                "requestSmsPermission" -> {
                    if (hasReceiveSmsPermission()) {
                        result.success(true)
                    } else {
                        pendingResult = result
                        ActivityCompat.requestPermissions(
                            this,
                            arrayOf(Manifest.permission.RECEIVE_SMS),
                            PERMISSION_REQUEST_CODE
                        )
                    }
                }
                "isSmsDetectionEnabled" -> {
                    val prefs = getSharedPreferences(FinProSmsReceiver.PREFS_NAME, Context.MODE_PRIVATE)
                    result.success(prefs.getBoolean(FinProSmsReceiver.ENABLED_KEY, false))
                }
                "setSmsDetectionEnabled" -> {
                    // Default is false: a malformed call must never turn
                    // detection on.
                    val enabled = call.argument<Boolean>("enabled") ?: false
                    val prefs = getSharedPreferences(FinProSmsReceiver.PREFS_NAME, Context.MODE_PRIVATE)
                    val stored = prefs.edit()
                        .putBoolean(FinProSmsReceiver.ENABLED_KEY, enabled)
                        .commit()
                    if (stored && !enabled) {
                        // Stop buffering immediately; drop anything not yet uploaded.
                        prefs.edit().putString(FinProSmsReceiver.BUFFER_KEY, "[]").commit()
                    }
                    // Report the real write outcome so Dart never claims the
                    // setting changed when it did not.
                    result.success(stored)
                }
                "getBufferedSms" -> {
                    val prefs = getSharedPreferences(FinProSmsReceiver.PREFS_NAME, Context.MODE_PRIVATE)
                    val rawJson = prefs.getString(FinProSmsReceiver.BUFFER_KEY, "[]") ?: "[]"
                    val list = mutableListOf<Map<String, Any>>()
                    try {
                        val arr = JSONArray(rawJson)
                        for (i in 0 until arr.length()) {
                            val obj = arr.getJSONObject(i)
                            val map = mutableMapOf<String, Any>()
                            map["sender"] = obj.optString("sender", "UNKNOWN")
                            map["body"] = obj.optString("body", "")
                            map["timestamp"] = obj.optLong("timestamp", System.currentTimeMillis())
                            list.add(map)
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                    result.success(list)
                }
                "clearBufferedSms" -> {
                    val prefs = getSharedPreferences(FinProSmsReceiver.PREFS_NAME, Context.MODE_PRIVATE)
                    prefs.edit().putString(FinProSmsReceiver.BUFFER_KEY, "[]").apply()
                    result.success(true)
                }
                else -> {
                    result.notImplemented()
                }
            }
        }

        // Minimal platform helper used for legal links (privacy policy, terms,
        // public account-deletion page). Keeping this here avoids adding a
        // browser/WebView dependency for a handful of static pages.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, PLATFORM_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "openUrl" -> {
                        val url = call.argument<String>("url")
                        result.success(openExternalUrl(url))
                    }
                    "installApk" -> {
                        // Only files the app itself downloaded into its cache
                        // are accepted; the path is re-validated here so Dart
                        // cannot broaden the install surface.
                        val path = call.argument<String>("filePath")
                        val error = installApk(path)
                        if (error == null) {
                            result.success(true)
                        } else {
                            result.error(error.first, error.second, null)
                        }
                    }
                    "openInstallPermissionSettings" -> {
                        result.success(openInstallPermissionSettings())
                    }
                    else -> result.notImplemented()
                }
            }

        // Connect real-time receiver listener
        FinProSmsReceiver.onSmsReceivedListener = { sender, body, timestamp ->
            runOnUiThread {
                smsChannel?.invokeMethod("onNewSmsReceived", mapOf(
                    "sender" to sender,
                    "body" to body,
                    "timestamp" to timestamp
                ))
            }
        }
    }

    private fun hasReceiveSmsPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECEIVE_SMS
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Starts the Android package installer for an APK in this app's cache.
     *
     * Returns `null` on success, or a `(code, message)` pair for a Dart
     * `PlatformException`. Files outside the cache directory, non-APK names
     * and missing files are rejected.
     */
    private fun installApk(rawPath: String?): Pair<String, String>? {
        if (rawPath.isNullOrBlank()) {
            return Pair("INVALID_ARGUMENT", "No APK path was provided.")
        }

        val file = try {
            File(rawPath).canonicalFile
        } catch (e: Exception) {
            return Pair("INVALID_ARGUMENT", "The APK path could not be resolved.")
        }

        if (!file.exists() || !file.isFile) {
            return Pair("FILE_NOT_FOUND", "The downloaded update file no longer exists.")
        }
        if (!file.name.endsWith(".apk", ignoreCase = true)) {
            return Pair("INVALID_ARGUMENT", "Only .apk files can be installed.")
        }

        val cacheRoot = try {
            cacheDir.canonicalFile
        } catch (e: Exception) {
            return Pair("INVALID_ARGUMENT", "The app cache directory is unavailable.")
        }
        if (!file.path.startsWith(cacheRoot.path + File.separator)) {
            return Pair("INVALID_ARGUMENT", "Updates must be installed from the app cache.")
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !packageManager.canRequestPackageInstalls()
        ) {
            return Pair(
                "PERMISSION_REQUIRED",
                "Allow FinPro to install unknown apps, then try again."
            )
        }

        return try {
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
            null
        } catch (e: Exception) {
            Pair("INSTALL_FAILED", e.message ?: "Android could not start the installer.")
        }
    }

    /** Opens the per-app "Install unknown apps" settings page. */
    private fun openInstallPermissionSettings(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        return try {
            val intent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:$packageName")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
            true
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Opens an absolute http(s) URL in the user's browser.
     *
     * Anything else (custom schemes, `file:`, `intent:`, missing host) is
     * rejected so a malformed constant cannot launch an arbitrary intent.
     * Returns true only when a browser activity actually handled it.
     */
    private fun openExternalUrl(rawUrl: String?): Boolean {
        if (rawUrl.isNullOrBlank()) return false
        val uri = try {
            Uri.parse(rawUrl)
        } catch (e: Exception) {
            return false
        }
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") return false
        if (uri.host.isNullOrBlank()) return false

        return try {
            val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
            }
            if (intent.resolveActivity(packageManager) == null) {
                false
            } else {
                startActivity(intent)
                true
            }
        } catch (e: Exception) {
            false
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            val granted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
            pendingResult?.success(granted)
            pendingResult = null
        }
    }

    override fun onDestroy() {
        FinProSmsReceiver.onSmsReceivedListener = null
        super.onDestroy()
    }
}
