package cz.springtrap.mobile

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import android.view.Gravity
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.content.Context
import android.widget.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlin.concurrent.thread

class MainActivity : Activity(), TextToSpeech.OnInitListener {
    private lateinit var log: TextView
    private lateinit var input: EditText
    private lateinit var apiKey: EditText
    private lateinit var sendButton: Button
    private lateinit var tts: TextToSpeech
    private var ttsReady = false
    private val history = mutableListOf<Pair<String, String>>()
    private val bg = Color.rgb(16, 22, 18)
    private val green = Color.rgb(184, 233, 134)
    private val textColor = Color.rgb(230, 238, 229)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        tts = TextToSpeech(this, this)
        window.statusBarColor = bg
        window.navigationBarColor = bg

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(12))
            setBackgroundColor(bg)
        }
        root.addView(TextView(this).apply {
            text = "SPRINGTRAP"
            textSize = 24f
            setTextColor(green)
            gravity = Gravity.CENTER
            setPadding(0, dp(6), 0, dp(4))
        })
        root.addView(SpringtrapPortrait(this), LinearLayout.LayoutParams(-1, dp(188)))
        root.addView(TextView(this).apply {
            text = "Mobilní prototyp • český společník"
            textSize = 13f
            gravity = Gravity.CENTER
            setTextColor(Color.LTGRAY)
        })

        apiKey = EditText(this).apply {
            hint = "Gemini API klíč (jen pro tuto relaci)"
            setHintTextColor(Color.GRAY)
            setTextColor(textColor)
            textSize = 14f
            inputType = 129
            setSingleLine(true)
            isSaveEnabled = false
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        }
        root.addView(apiKey, LinearLayout.LayoutParams(-1, dp(52)))

        val scroll = ScrollView(this).apply { isFillViewport = true }
        log = TextView(this).apply {
            text = "Springtrap: Jsem vzhůru. Vlož API klíč a napiš mi. Klíč se neukládá do souboru.\n\n"
            textSize = 15f
            setTextColor(textColor)
            setPadding(dp(10), dp(10), dp(10), dp(10))
        }
        scroll.addView(log)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        scroll.viewTreeObserver.addOnGlobalLayoutListener {
            scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
        }

        input = EditText(this).apply {
            hint = "Napiš Springtrapovi…"
            setHintTextColor(Color.GRAY)
            setTextColor(textColor)
            textSize = 16f
            setSingleLine(true)
        }
        root.addView(input, LinearLayout.LayoutParams(-1, dp(52)))

        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        sendButton = Button(this).apply {
            text = "Odeslat"
            setOnClickListener { sendMessage() }
        }
        buttons.addView(sendButton, LinearLayout.LayoutParams(0, dp(52), 1f))
        buttons.addView(Button(this).apply {
            text = "🎙 Mluvit"
            setOnClickListener { startListening() }
        }, LinearLayout.LayoutParams(0, dp(52), 1f))
        buttons.addView(Button(this).apply {
            text = "🔊 Hlas"
            setOnClickListener { speakLastReply() }
        }, LinearLayout.LayoutParams(0, dp(52), 1f))
        root.addView(buttons)
        setContentView(root)
    }

    private fun sendMessage() {
        val message = input.text.toString().trim()
        val key = apiKey.text.toString().trim()
        if (message.isEmpty()) return
        if (key.isEmpty()) {
            append("Systém", "Nejdřív vlož Gemini API klíč.")
            return
        }
        input.setText("")
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(input.windowToken, 0)
        append("Ty", message)
        sendButton.isEnabled = false
        append("Systém", "Springtrap přemýšlí…")

        thread {
            try {
                val contextText = history.takeLast(12).joinToString("\n") { "${it.first}: ${it.second}" }
                val prompt = "Jsi Springtrap z Five Nights at Freddy's 3, virtuální společník. Mluv přirozenou češtinou, buď hravý a lehce sarkastický, ale užitečný. Neříkej, že vidíš obrazovku nebo ovládáš zařízení, pokud to není skutečně dostupné.\n\nPředchozí konverzace:\n$contextText\n\nUživatel: $message"
                val reply = askGemini(key, prompt)
                history.add("Uživatel" to message)
                history.add("Springtrap" to reply)
                runOnUiThread {
                    sendButton.isEnabled = true
                    append("Springtrap", reply)
                    if (ttsReady) tts.speak(reply, TextToSpeech.QUEUE_FLUSH, null, "springtrap-reply")
                }
            } catch (e: Exception) {
                runOnUiThread {
                    sendButton.isEnabled = true
                    append("Chyba", e.message ?: "Nepodařilo se spojit s Gemini.")
                }
            }
        }
    }

    private fun askGemini(key: String, prompt: String): String {
        val model = "gemini-3.8-flash"
        val url = URL("https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent")
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 20000
            readTimeout = 45000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("x-goog-api-key", key)
        }
        try {
            val body = JSONObject()
                .put("contents", org.json.JSONArray().put(JSONObject()
                    .put("role", "user")
                    .put("parts", org.json.JSONArray().put(JSONObject().put("text", prompt)))))
                .put("generationConfig", JSONObject().put("maxOutputTokens", 500))
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val response = stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            if (code !in 200..299) throw IllegalStateException("Gemini HTTP $code: " + response.take(500))
            val json = JSONObject(response)
            return json.getJSONArray("candidates").getJSONObject(0)
                .getJSONObject("content").getJSONArray("parts").getJSONObject(0).getString("text").trim()
        } finally {
            connection.disconnect()
        }
    }

    private fun startListening() {
        try {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "cs-CZ")
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Řekni Springtrapovi, co potřebuješ")
            }
            startActivityForResult(intent, SPEECH_REQUEST)
        } catch (_: Exception) {
            append("Systém", "Hlasové rozpoznávání není v telefonu dostupné. Zkus napsat zprávu.")
        }
    }

    @Deprecated("Legacy callback is kept for broad Android compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == SPEECH_REQUEST && resultCode == RESULT_OK) {
            val spoken = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
            if (!spoken.isNullOrBlank()) {
                input.setText(spoken)
                sendMessage()
            }
        }
    }

    private fun speakLastReply() {
        val last = history.lastOrNull { it.first == "Springtrap" }?.second
        if (last == null) append("Systém", "Springtrap zatím nic neodpověděl.")
        else if (ttsReady) tts.speak(last, TextToSpeech.QUEUE_FLUSH, null, "springtrap-repeat")
    }

    private fun append(who: String, message: String) {
        log.append("$who: $message\n\n")
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            ttsReady = true
            tts.language = Locale("cs", "CZ")
        }
    }

    override fun onDestroy() {
        if (::tts.isInitialized) tts.shutdown()
        super.onDestroy()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    /** Original 2D animatronic portrait, drawn locally so the app needs no image download. */
    private inner class SpringtrapPortrait(context: Context) : View(context) {
        private val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
        private fun shape(color: Int, style: android.graphics.Paint.Style = android.graphics.Paint.Style.FILL) {
            paint.color = color
            paint.style = style
            paint.strokeWidth = dp(3).toFloat()
        }

        override fun onDraw(canvas: android.graphics.Canvas) {
            super.onDraw(canvas)
            val cx = width / 2f
            val scale = minOf(width / 240f, height / 188f)
            canvas.save()
            canvas.translate(cx - 120f * scale, (height - 188f * scale) / 2f)
            canvas.scale(scale, scale)

            val dark = Color.rgb(29, 38, 28)
            val suit = Color.rgb(91, 111, 65)
            val worn = Color.rgb(125, 137, 75)
            val seam = Color.rgb(39, 48, 34)
            val rust = Color.rgb(91, 65, 43)
            val eye = Color.rgb(255, 66, 36)

            // Torn rabbit ears and exposed inner mechanisms.
            shape(seam)
            canvas.drawRoundRect(53f, 5f, 92f, 83f, 13f, 13f, paint)
            shape(suit)
            canvas.drawRoundRect(59f, 12f, 83f, 72f, 8f, 8f, paint)
            shape(rust)
            canvas.drawRect(68f, 27f, 75f, 68f, paint)
            shape(seam)
            canvas.drawRoundRect(130f, 17f, 169f, 88f, 12f, 12f, paint)
            shape(suit)
            canvas.drawRoundRect(135f, 22f, 164f, 82f, 9f, 9f, paint)
            shape(dark)
            canvas.drawRect(146f, 27f, 154f, 80f, paint)

            // Head silhouette and battered cheek plates.
            shape(seam)
            val head = android.graphics.Path().apply {
                moveTo(61f, 52f); lineTo(79f, 37f); lineTo(145f, 38f)
                lineTo(173f, 57f); lineTo(181f, 103f); lineTo(166f, 143f)
                lineTo(144f, 158f); lineTo(87f, 153f); lineTo(62f, 132f)
                lineTo(52f, 89f); close()
            }
            canvas.drawPath(head, paint)
            shape(suit)
            canvas.drawRoundRect(61f, 52f, 174f, 143f, 28f, 28f, paint)
            shape(worn)
            canvas.drawRoundRect(73f, 62f, 162f, 129f, 23f, 23f, paint)
            shape(rust)
            canvas.drawRoundRect(68f, 82f, 88f, 113f, 7f, 7f, paint)
            canvas.drawRoundRect(149f, 88f, 169f, 119f, 7f, 7f, paint)

            // Dark sockets and glowing eyes.
            shape(dark)
            canvas.drawOval(78f, 75f, 111f, 98f, paint)
            canvas.drawOval(125f, 75f, 157f, 98f, paint)
            shape(eye)
            canvas.drawCircle(96f, 86f, 5f, paint)
            canvas.drawCircle(141f, 86f, 5f, paint)
            shape(Color.rgb(255, 190, 120))
            canvas.drawCircle(97f, 85f, 1.7f, paint)
            canvas.drawCircle(142f, 85f, 1.7f, paint)

            // Broken muzzle, jagged teeth and cracks.
            shape(dark)
            canvas.drawRoundRect(88f, 105f, 151f, 138f, 8f, 8f, paint)
            shape(Color.rgb(181, 173, 130))
            for (i in 0..5) {
                val x = 94f + i * 9f
                canvas.drawRect(x, 106f, x + 5f, if (i % 2 == 0) 120f else 116f, paint)
            }
            shape(seam, android.graphics.Paint.Style.STROKE)
            canvas.drawLine(75f, 58f, 91f, 66f, paint)
            canvas.drawLine(154f, 57f, 165f, 72f, paint)
            canvas.drawLine(81f, 119f, 70f, 135f, paint)
            canvas.drawLine(153f, 126f, 163f, 137f, paint)
            shape(rust)
            canvas.drawCircle(70f, 72f, 3f, paint)
            canvas.drawCircle(161f, 108f, 3f, paint)
            canvas.restore()
        }
    }

    companion object { private const val SPEECH_REQUEST = 4107 }
}
