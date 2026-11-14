package com.patron.patron_admin

import java.util.regex.Pattern

/**
 * Keeps one-time codes, PINs and passwords inside the listener.
 *
 * Same rules as lib/bank/sensitive_filter.dart (the app runs them again on
 * every item it receives). Keep the two rule sets identical.
 *  1. Anything that reads like an OTP / PIN / password message is dropped whole.
 *  2. Card numbers (13–19 digits) are masked to the last 4.
 */
object SensitiveText {
    private const val FLAGS = Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE

    private val SECRET_WORDS: Pattern = Pattern.compile(
        """(\botp\b|one[\s-]?time|verification code|security code|confirmation code|""" +
            """auth(entication)? code|pass\s?code|password|\bpin\b|""" +
            """mot de passe|code (de )?(v[ée]rification|confirmation|s[ée]curit[ée]|secret|pin)|""" +
            """ne (le )?partagez|do not share|don.?t share|never share|""" +
            """رمز التحقق|رمز التأكيد|رمز التفعيل|رمز الدخول|رمز سري|الرمز السري|""" +
            """كلمة السر|كلمة المرور|كلمة العبور|كود التحقق|كود التفعيل|رمز لمرة واحدة|""" +
            """لا تشارك|لا تعط)""",
        FLAGS,
    )

    private val CODE_PATTERN: Pattern = Pattern.compile(
        """((\bcode\b|كود|رمز)\s*[:：-]?\s*\d{4,8}\b)|""" +
            """(\b\d{4,8}\s+(is your|est votre)\b)|""" +
            """((your|votre) code\b)""",
        FLAGS,
    )

    /** 13–19 digits in one run, or grouped by four; order numbers and references stay. */
    private val CARD_NUMBER: Pattern = Pattern.compile("""\b(?:\d{13,19}|(?:\d{4}[ -]){3}\d{1,7})\b""")

    data class Kept(val title: String?, val text: String)

    /** Null when the notification must not leave the listener. */
    fun filter(title: String?, text: String): Kept? {
        val t = title?.trim().orEmpty()
        val body = text.trim()
        if (body.isEmpty()) return null
        val joined = "$t\n$body"
        if (SECRET_WORDS.matcher(joined).find()) return null
        if (CODE_PATTERN.matcher(joined).find()) return null
        return Kept(if (t.isEmpty()) null else maskCardNumbers(t), maskCardNumbers(body))
    }

    fun maskCardNumbers(input: String): String {
        val m = CARD_NUMBER.matcher(input)
        val out = StringBuffer()
        while (m.find()) {
            val digits = m.group().replace(Regex("[ -]"), "")
            m.appendReplacement(out, "•••• " + digits.takeLast(4))
        }
        m.appendTail(out)
        return out.toString()
    }
}
