package com.finpro.app.finpro_mobile

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import androidx.annotation.NonNull
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import org.json.JSONArray

class MainActivity : FlutterActivity() {

    private val SMS_CHANNEL = "com.finpro.app/sms_channel"
    private val PERMISSION_REQUEST_CODE = 44101
    private var pendingResult: MethodChannel.Result? = null
    private var methodChannel: MethodChannel? = null

    override fun configureFlutterEngine(@NonNull flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        methodChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, SMS_CHANNEL)
        methodChannel?.setMethodCallHandler { call, result ->
            when (call.method) {
                "checkSmsPermission" -> {
                    val hasReceive = ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
                    val hasRead = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
                    result.success(hasReceive && hasRead)
                }
                "requestSmsPermission" -> {
                    val hasReceive = ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
                    val hasRead = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
                    if (hasReceive && hasRead) {
                        result.success(true)
                    } else {
                        pendingResult = result
                        ActivityCompat.requestPermissions(
                            this,
                            arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS),
                            PERMISSION_REQUEST_CODE
                        )
                    }
                }
                "isSmsDetectionEnabled" -> {
                    val prefs = getSharedPreferences(FinProSmsReceiver.PREFS_NAME, Context.MODE_PRIVATE)
                    result.success(prefs.getBoolean(FinProSmsReceiver.ENABLED_KEY, true))
                }
                "setSmsDetectionEnabled" -> {
                    val enabled = call.argument<Boolean>("enabled") ?: true
                    val prefs = getSharedPreferences(FinProSmsReceiver.PREFS_NAME, Context.MODE_PRIVATE)
                    prefs.edit().putBoolean(FinProSmsReceiver.ENABLED_KEY, enabled).apply()
                    if (!enabled) {
                        // Stop buffering immediately; drop anything not yet uploaded.
                        prefs.edit().putString(FinProSmsReceiver.BUFFER_KEY, "[]").apply()
                    }
                    result.success(enabled)
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
                "readRecentInboxSms" -> {
                    val list = readRecentInboxFinancialMessages()
                    result.success(list)
                }
                else -> {
                    result.notImplemented()
                }
            }
        }

        // Connect real-time receiver listener
        FinProSmsReceiver.onSmsReceivedListener = { sender, body, timestamp ->
            runOnUiThread {
                methodChannel?.invokeMethod("onNewSmsReceived", mapOf(
                    "sender" to sender,
                    "body" to body,
                    "timestamp" to timestamp
                ))
            }
        }
    }

    private fun readRecentInboxFinancialMessages(): List<Map<String, Any>> {
        val list = mutableListOf<Map<String, Any>>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            return list
        }

        try {
            val uri = Uri.parse("content://sms/inbox")
            val projection = arrayOf("_id", "address", "body", "date")
            val cursor: Cursor? = contentResolver.query(uri, projection, null, null, "date DESC LIMIT 50")

            cursor?.use {
                val addressIdx = it.getColumnIndex("address")
                val bodyIdx = it.getColumnIndex("body")
                val dateIdx = it.getColumnIndex("date")

                while (it.moveToNext()) {
                    val address = if (addressIdx != -1) it.getString(addressIdx) ?: "" else ""
                    val body = if (bodyIdx != -1) it.getString(bodyIdx) ?: "" else ""
                    val date = if (dateIdx != -1) it.getLong(dateIdx) else System.currentTimeMillis()

                    val lower = body.lowercase()
                    // Filter out OTPs
                    if (lower.contains("otp") || lower.contains("verification code")) continue

                    // Check for financial triggers
                    val isFinancial = lower.contains("debited") || lower.contains("credited") ||
                                      lower.contains("spent") || lower.contains("withdrawn") ||
                                      lower.contains("inr") || lower.contains("rs.") || lower.contains("₹")

                    if (isFinancial) {
                        list.add(mapOf(
                            "sender" to address,
                            "body" to body,
                            "timestamp" to date
                        ))
                    }
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return list
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
