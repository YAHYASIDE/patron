package com.patron.patron_admin

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * The listener's own small store: the owner's choices and the notices kept
 * while the app was closed. Lives in the app's private storage and survives
 * restarts; the Flutter side copies items into its upload queue and then
 * acknowledges them here.
 */
object BankListenerStore {
    private const val PREFS = "patron_bank_listener"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_PACKAGES = "packages"
    private const val KEY_PENDING = "pending"
    private const val KEY_DROPPED = "dropped"

    /** Oldest items are dropped past this; the app drains far more often. */
    private const val MAX_PENDING = 500

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Off by default: nothing is read until the owner turns it on. */
    fun isEnabled(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_ENABLED, false)

    fun packages(ctx: Context): Set<String> = prefs(ctx).getStringSet(KEY_PACKAGES, emptySet())?.toSet() ?: emptySet()

    fun setConfig(ctx: Context, enabled: Boolean, packages: Collection<String>) {
        prefs(ctx).edit()
            .putBoolean(KEY_ENABLED, enabled)
            .putStringSet(KEY_PACKAGES, packages.toSet())
            .commit()
    }

    @Synchronized
    fun add(ctx: Context, item: JSONObject): Boolean {
        val list = readPending(ctx)
        val id = item.optString("id")
        for (i in 0 until list.length()) {
            if (list.optJSONObject(i)?.optString("id") == id) return false
        }
        list.put(item)
        val trimmed = if (list.length() > MAX_PENDING) {
            JSONArray().also { out ->
                for (i in (list.length() - MAX_PENDING) until list.length()) out.put(list.get(i))
            }
        } else {
            list
        }
        prefs(ctx).edit().putString(KEY_PENDING, trimmed.toString()).commit()
        return true
    }

    @Synchronized
    fun pending(ctx: Context): List<Map<String, Any?>> {
        val list = readPending(ctx)
        val out = ArrayList<Map<String, Any?>>(list.length())
        for (i in 0 until list.length()) {
            val o = list.optJSONObject(i) ?: continue
            out.add(
                mapOf(
                    "id" to o.optString("id"),
                    "package" to o.optString("package"),
                    "title" to if (o.isNull("title")) null else o.optString("title"),
                    "text" to o.optString("text"),
                    "postedAt" to o.optLong("postedAt"),
                ),
            )
        }
        return out
    }

    @Synchronized
    fun ack(ctx: Context, ids: Collection<String>) {
        if (ids.isEmpty()) return
        val drop = ids.toSet()
        val list = readPending(ctx)
        val kept = JSONArray()
        for (i in 0 until list.length()) {
            val o = list.optJSONObject(i) ?: continue
            if (o.optString("id") !in drop) kept.put(o)
        }
        prefs(ctx).edit().putString(KEY_PENDING, kept.toString()).commit()
    }

    /** Only a count is kept for dropped secrets, never their text. */
    @Synchronized
    fun incrementDropped(ctx: Context) {
        val p = prefs(ctx)
        p.edit().putInt(KEY_DROPPED, p.getInt(KEY_DROPPED, 0) + 1).apply()
    }

    fun droppedCount(ctx: Context): Int = prefs(ctx).getInt(KEY_DROPPED, 0)

    private fun readPending(ctx: Context): JSONArray =
        try {
            JSONArray(prefs(ctx).getString(KEY_PENDING, "[]") ?: "[]")
        } catch (e: Exception) {
            JSONArray()
        }
}
