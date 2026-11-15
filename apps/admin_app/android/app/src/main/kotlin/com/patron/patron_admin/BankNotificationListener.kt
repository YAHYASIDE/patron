package com.patron.patron_admin

import android.app.Notification
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import io.flutter.plugin.common.EventChannel
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Reads payment notifications from the bank apps the owner selected.
 *
 * - Android only binds this service after the owner enables "Patron الإدارة"
 *   in Settings › Notification access. The app never grants itself access.
 * - Off by default; while off, or for any app not selected, the notification
 *   is ignored without reading its text.
 * - OTP / PIN / password-like notifications are dropped here and card
 *   numbers masked (SensitiveText) before anything is stored.
 * - Kept items go to BankListenerStore; the Flutter app uploads them as
 *   evidence. Nothing here confirms a payment.
 */
class BankNotificationListener : NotificationListenerService() {

    companion object {
        /** Set by MainActivity while the Flutter UI listens; null otherwise. */
        @Volatile
        var eventSink: EventChannel.EventSink? = null

        private const val MAX_TEXT = 2000

        fun notifyFlutter() {
            val sink = eventSink ?: return
            Handler(Looper.getMainLooper()).post {
                try {
                    sink.success("new")
                } catch (e: Exception) {
                    // The UI went away between the check and the post.
                }
            }
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        val ctx = applicationContext
        if (!BankListenerStore.isEnabled(ctx)) return
        val pkg = sbn.packageName ?: return
        if (pkg == ctx.packageName) return
        if (pkg !in BankListenerStore.packages(ctx)) return

        val n = sbn.notification ?: return
        if ((n.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return
        if ((n.flags and Notification.FLAG_ONGOING_EVENT) != 0) return

        val extras = n.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
        val text = (
            extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
                ?: extras.getCharSequence(Notification.EXTRA_TEXT)
                ?: lines?.joinToString("\n")
            )?.toString()?.take(MAX_TEXT) ?: return

        val kept = SensitiveText.filter(title, text)
        if (kept == null) {
            BankListenerStore.incrementDropped(ctx)
            return
        }

        val postedAt = sbn.postTime
        val item = JSONObject()
            .put("id", fingerprint(pkg, postedAt, kept.title, kept.text))
            .put("package", pkg)
            .put("title", kept.title ?: JSONObject.NULL)
            .put("text", kept.text)
            .put("postedAt", postedAt)
        if (BankListenerStore.add(ctx, item)) notifyFlutter()
    }

    /** Same app, time and text → same id, so a repeat is recognised. */
    private fun fingerprint(pkg: String, postedAt: Long, title: String?, text: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$pkg|$postedAt|${title.orEmpty()}|$text".toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }.take(32)
    }
}
