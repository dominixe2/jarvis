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
        root.addView(TextView(this).apply {
            text = "🐰"
            textSize = 64f
            gravity = Gravity.CENTER
            setTextColor(green)
        })
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
        }
        root.addView(apiKey, LinearLayout.LayoutParams(-1, dp(52)))

        val scroll = ScrollView(this)
        log = TextView(this).apply {
            text = "Springtrap: Jsem vzhůru. Vlož API klíč a napiš mi. Klíč se neukládá do souboru.\n\n"
            textSize = 15f
            setTextColor(textColor)
            setPadding(dp(10), dp(10), dp(10), dp(10))
        }
        scroll.addView(log)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))

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

    companion object { private const val SPEECH_REQUEST = 4107 }
}
