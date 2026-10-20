package com.patron.patron_admin

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.os.Build
import android.provider.Settings
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

/**
 * FlutterFragmentActivity because local_auth needs a FragmentActivity.
 * Also hosts the bridge to the bank-notification listener
 * (lib/bank/listener_channel.dart).
 */
class MainActivity : FlutterFragmentActivity() {

    companion object {
        private const val METHODS = "patron/bank_listener"
        private const val EVENTS = "patron/bank_listener/events"

        /** Words that make an installed app worth suggesting. A suggestion only: the owner decides. */
        private val BANK_HINTS = listOf(
            "bank", "banque", "bankily", "masrvi", "sedad", "bpm", "bmci", "gbm", "bim", "nbm",
            "attijari", "wallet", "pay", "cash", "money", "flous", "بنك", "مصرف",
        )
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val messenger = flutterEngine.dartExecutor.binaryMessenger

        MethodChannel(messenger, METHODS).setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "isAccessGranted" -> result.success(isAccessGranted())
                    "openAccessSettings" -> {
                        openAccessSettings()
                        result.success(null)
                    }
                    "getConfig" -> result.success(
                        mapOf(
                            "enabled" to BankListenerStore.isEnabled(this),
                            "packages" to BankListenerStore.packages(this).toList(),
                        ),
                    )
                    "setConfig" -> {
                        val enabled = call.argument<Boolean>("enabled") ?: false
                        val packages = call.argument<List<String>>("packages") ?: emptyList()
                        BankListenerStore.setConfig(this, enabled, packages)
                        result.success(null)
                    }
                    "fetchPending" -> result.success(BankListenerStore.pending(this))
                    "ack" -> {
                        BankListenerStore.ack(this, call.argument<List<String>>("ids") ?: emptyList())
                        result.success(null)
                    }
                    "droppedCount" -> result.success(BankListenerStore.droppedCount(this))
                    "describeApps" -> result.success(
                        (call.argument<List<String>>("packages") ?: emptyList()).map { describe(it) },
                    )
                    "suggestApps" -> result.success(suggestApps())
                    else -> result.notImplemented()
                }
            } catch (e: Exception) {
                result.error("BANK_LISTENER", e.javaClass.simpleName, null)
            }
        }

        EventChannel(messenger, EVENTS).setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                BankNotificationListener.eventSink = events
            }

            override fun onCancel(arguments: Any?) {
                BankNotificationListener.eventSink = null
            }
        })
    }

    override fun onDestroy() {
        BankNotificationListener.eventSink = null
        super.onDestroy()
    }

    /** True only when the owner enabled us in Settings › Notification access. */
    private fun isAccessGranted(): Boolean {
        val me = ComponentName(this, BankNotificationListener::class.java)
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        return flat.split(":").mapNotNull { ComponentName.unflattenFromString(it) }.any { it == me }
    }

    private fun openAccessSettings() {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    private fun describe(pkg: String): Map<String, Any?> =
        try {
            val info = packageManager.getApplicationInfo(pkg, 0)
            mapOf("package" to pkg, "label" to packageManager.getApplicationLabel(info).toString(), "installed" to true)
        } catch (e: PackageManager.NameNotFoundException) {
            mapOf("package" to pkg, "label" to null, "installed" to false)
        }

    /** Launchable apps whose package or name looks like a bank or wallet. */
    private fun suggestApps(): List<Map<String, Any?>> {
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val found: List<ResolveInfo> = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            packageManager.queryIntentActivities(launcher, 0)
        }
        return found
            .map { it.activityInfo.packageName to it.loadLabel(packageManager).toString() }
            .distinctBy { it.first }
            .filter { (pkg, label) ->
                pkg != packageName && BANK_HINTS.any { hint ->
                    pkg.lowercase().contains(hint) || label.lowercase().contains(hint)
                }
            }
            .sortedBy { it.second }
            .map { (pkg, label) -> mapOf("package" to pkg, "label" to label, "installed" to true) }
    }
}
