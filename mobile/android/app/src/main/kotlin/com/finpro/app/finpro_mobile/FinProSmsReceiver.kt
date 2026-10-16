package com.finpro.app.finpro_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * BroadcastReceiver for incoming SMS on Android.
 * Securely captures banking SMS candidates and stores them in a local shared buffer
 * so the Flutter UI can immediately process or review pending candidates.
 */
class FinProSmsReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "FinProSmsReceiver"
        const val PREFS_NAME = "finpro_sms_buffer_prefs"
        const val BUFFER_KEY = "buffered_sms_messages"

        /** User-controlled switch: when false, ignore incoming SMS entirely. */
        const val ENABLED_KEY = "sms_detection_enabled"

        // Callback hook when MainActivity is active in foreground
        var onSmsReceivedListener: ((sender: String, body: String, timestamp: Long) -> Unit)? = null
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            try {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

                // Respect the in-app toggle: a disabled user should never be
                // processed, buffered, or uploaded.
                if (!prefs.getBoolean(ENABLED_KEY, true)) {
                    Log.d(TAG, "SMS detection disabled by user; ignoring message")
                    return
                }

                val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
                if (messages.isNullOrEmpty()) return

                val sender = messages[0].displayOriginatingAddress ?: "UNKNOWN"
                val timestamp = messages[0].timestampMillis

                val bodyBuilder = StringBuilder()
                for (sms in messages) {
                    bodyBuilder.append(sms.displayMessageBody ?: "")
                }
                val body = bodyBuilder.toString().trim()

                // Quick pre-filter: Skip OTPs immediately to protect user privacy
                val lower = body.lowercase()
                if (lower.contains("otp") || lower.contains("verification code") || lower.contains("secret code")) {
                    Log.d(TAG, "Skipping OTP message from $sender for privacy")
                    return
                }

                // Check if likely a financial message
                val isFinancial = lower.contains("debited") || lower.contains("credited") ||
                                  lower.contains("spent") || lower.contains("withdrawn") ||
                                  lower.contains("inr") || lower.contains("rs.") || lower.contains("₹")

                if (!isFinancial) {
                    Log.d(TAG, "Ignoring non-financial SMS from $sender")
                    return
                }

                Log.d(TAG, "Detected financial SMS candidate from $sender: $body")

                // 1. Notify active listener if MainActivity is foreground
                onSmsReceivedListener?.invoke(sender, body, timestamp)

                // 2. Persist to local buffer in SharedPreferences for reliable pickup
                val existingJson = prefs.getString(BUFFER_KEY, "[]") ?: "[]"
                val jsonArray = JSONArray(existingJson)

                val item = JSONObject().apply {
                    put("sender", sender)
                    put("body", body)
                    put("timestamp", timestamp)
                }

                jsonArray.put(item)
                prefs.edit().putString(BUFFER_KEY, jsonArray.toString()).apply()

            } catch (e: Exception) {
                Log.e(TAG, "Error handling incoming SMS", e)
            }
        }
    }
}
