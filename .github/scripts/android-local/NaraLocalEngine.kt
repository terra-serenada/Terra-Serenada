package com.terra.serenada

import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.collect
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Native on-device inference bridge for the existing Nara JavaScript adapter.
 * A user imports a licensed .litertlm model once; the model is copied to the
 * app-private files directory and remains available offline across app updates.
 */
class NaraLocalEngine(
    private val activity: MainActivity,
    @Suppress("unused") private val webView: WebView
) {
    @Volatile private var engine: Engine? = null
    @Volatile private var loading: Boolean = false
    @Volatile private var loadedModelPath: String? = null
    private val queue = Executors.newSingleThreadExecutor { r -> Thread(r, "nara-litertlm").apply { isDaemon = true } }

    @JavascriptInterface
    fun isModelReady(): Boolean = engine != null

    @JavascriptInterface
    fun selectLocalModel(): Boolean {
        activity.requestNaraModelSelection()
        return true
    }

    @JavascriptInterface
    fun downloadRecommendedModel(): Boolean {
        if (loading) {
            activity.setNaraLocalStatus("Model sedang disiapkan. Tunggu sampai proses saat ini selesai.", false)
            return false
        }
        queue.execute {
            loading = true
            var connection: HttpURLConnection? = null
            val modelDir = File(activity.filesDir, "models")
            val temporary = File(modelDir, "nara-model.litertlm.download")
            val destination = File(modelDir, "nara-model.litertlm")
            try {
                if (!modelDir.exists() && !modelDir.mkdirs()) throw IllegalStateException("Folder penyimpanan model tidak dapat dibuat.")
                // The selected public OLMo-2 1B LiteRT-LM bundle is Apache-2.0 licensed.
                // At least 1.25 GB free is required for the download plus temporary overhead.
                if (modelDir.usableSpace < 1_250_000_000L) throw IllegalStateException("Ruang kosong kurang dari 1,25 GB. Hapus file lain atau gunakan file model yang lebih kecil.")
                activity.setNaraLocalStatus("Mengunduh model dasar (~0,93 GB). Unduhan ini hanya diperlukan sekali; jangan tutup aplikasi.", false)
                connection = (URL(RECOMMENDED_MODEL_URL).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 20000
                    readTimeout = 60000
                    instanceFollowRedirects = true
                    requestMethod = "GET"
                    setRequestProperty("User-Agent", "TerraSerenada-Nara/1.0")
                }
                val code = connection.responseCode
                if (code !in 200..299) throw IllegalStateException("Server model mengembalikan HTTP $code. Coba lagi atau impor file .litertlm.")
                val expected = connection.contentLengthLong
                connection.inputStream.use { input ->
                    temporary.outputStream().buffered(1024 * 1024).use { output ->
                        val buffer = ByteArray(1024 * 1024)
                        var total = 0L
                        var lastPercent = -10
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            output.write(buffer, 0, count)
                            total += count
                            if (expected > 0) {
                                val percent = ((total * 100) / expected).toInt().coerceIn(0, 100)
                                if (percent >= lastPercent + 5) {
                                    activity.setNaraLocalStatus("Mengunduh model lokal: $percent%.", false)
                                    lastPercent = percent
                                }
                            }
                        }
                        output.flush()
                    }
                }
                if (temporary.length() < 100_000_000L || (expected > 0 && temporary.length() != expected)) {
                    throw IllegalStateException("Unduhan model tidak lengkap. Coba lagi dengan koneksi internet stabil.")
                }
                if (destination.exists() && !destination.delete()) throw IllegalStateException("Model lama tidak dapat diganti. Pastikan penyimpanan cukup.")
                if (!temporary.renameTo(destination)) throw IllegalStateException("Tidak dapat menyimpan model hasil unduhan.")
                loadModelNow(destination.absolutePath)
            } catch (e: Exception) {
                temporary.delete()
                activity.setNaraLocalStatus("Unduhan model gagal: ${e.message ?: e.javaClass.simpleName}. Kamu masih bisa memilih file .litertlm yang sudah diunduh.", false)
            } finally {
                connection?.disconnect()
                loading = false
            }
        }
        return true
    }

    @JavascriptInterface
    fun generate(payload: String): String {
        val request = try { JSONObject(payload) } catch (_: Exception) { return false.toString() }
        val requestId = request.optString("requestId", "")
        if (loading || engine == null) {
            val why = if (loading) "Model lokal masih disiapkan. Tunggu sampai status Model lokal siap." else "Belum ada model lokal. Unduh model LiteRT-LM atau pilih file .litertlm yang kompatibel."
            activity.deliverNaraLocalResult(requestId, JSONObject().put("error", JSONObject().put("message", why)).toString())
            return "pending"
        }

        queue.execute {
            try {
                val active = engine ?: throw IllegalStateException("Model lokal belum siap.")
                val messages = request.optJSONArray("messages") ?: JSONArray()
                val systemText = StringBuilder()
                val conversationText = StringBuilder()
                for (i in 0 until messages.length()) {
                    val item = messages.optJSONObject(i) ?: continue
                    val role = item.optString("role", "user")
                    val content = item.optString("content", "")
                    if (content.isBlank()) continue
                    when (role) {
                        "system" -> systemText.append(content).append("\n\n")
                        "assistant" -> conversationText.append("NARA SEBELUMNYA: ").append(content).append("\n\n")
                        else -> conversationText.append("PENGGUNA: ").append(content).append("\n\n")
                    }
                }
                if (conversationText.isBlank()) conversationText.append("Jawab pengguna sebagai Nara, asisten berkebun Terra Serenada.")

                val output = StringBuilder()
                active.createConversation(
                    ConversationConfig(systemInstruction = Contents.of(systemText.toString()))
                ).use { conversation ->
                    runBlocking {
                        conversation.sendMessageAsync(conversationText.toString()).collect { chunk -> output.append(chunk) }
                    }
                }
                if (output.isBlank()) throw IllegalStateException("Model selesai tanpa menghasilkan teks.")
                val result = JSONObject()
                    .put("model", "LiteRT-LM lokal")
                    .put("choices", JSONArray().put(JSONObject().put("message", JSONObject().put("role", "assistant").put("content", output.toString()))))
                activity.deliverNaraLocalResult(requestId, result.toString())
            } catch (e: Exception) {
                activity.deliverNaraLocalResult(
                    requestId,
                    JSONObject().put("error", JSONObject().put("message", "Inferensi lokal gagal: ${e.message ?: e.javaClass.simpleName}")).toString()
                )
            }
        }
        return "pending"
    }

    fun loadModel(path: String) {
        if (loading) {
            activity.setNaraLocalStatus("Model sedang disiapkan. Tunggu sampai proses saat ini selesai.", false)
            return
        }
        queue.execute { loadModelNow(path) }
    }

    private fun loadModelNow(path: String) {
        loading = true
        activity.setNaraLocalStatus("Memuat model lokal. Tunggu sampai selesai sebelum menguji Nara.", false)
        var candidate: Engine? = null
        try {
            val file = File(path)
            require(file.isFile && file.length() > 1_000_000L) { "File model tidak ditemukan atau terlalu kecil." }
            candidate = Engine(EngineConfig(modelPath = file.absolutePath, backend = Backend.CPU(), cacheDir = activity.cacheDir.absolutePath))
            candidate.initialize()
            val previous = engine
            engine = candidate
            candidate = null
            loadedModelPath = file.absolutePath
            try { previous?.close() } catch (_: Exception) {}
            activity.setNaraLocalStatus("Model lokal siap. Permintaan Nara diproses di perangkat; model tersimpan untuk penggunaan offline.", true)
        } catch (e: Exception) {
            try { candidate?.close() } catch (_: Exception) {}
            engine = null
            loadedModelPath = null
            activity.setNaraLocalStatus("Model gagal dimuat: ${e.message ?: "format model tidak cocok dengan runtime"}. Pastikan file .litertlm berasal dari sumber resmi yang kompatibel.", false)
        } finally {
            loading = false
        }
    }

    fun resumeStoredModel() {
        if (engine != null) { publishStatus(); return }
        if (loading) return
        val file = File(activity.filesDir, "models/nara-model.litertlm")
        if (file.isFile && file.length() > 1_000_000L) loadModel(file.absolutePath) else publishStatus()
    }

    fun publishStatus() {
        val ready = engine != null
        val message = when {
            ready -> "Model lokal siap. Percakapan Nara memakai inferensi di perangkat dan dapat berjalan offline."
            loading -> "Model lokal sedang dimuat. Tunggu sebelum mengirim permintaan."
            else -> "Belum ada model yang dipilih. Unduh model .litertlm yang kompatibel lalu pilih melalui tombol Pilih model offline."
        }
        activity.setNaraLocalStatus(message, ready)
    }

    fun close() {
        queue.shutdown()
        try { engine?.close() } catch (_: Exception) {}
        engine = null
    }

    companion object {
        private const val RECOMMENDED_MODEL_URL = "https://huggingface.co/litert-community/OLMo-2-1B-Instruct/resolve/main/OLMo-2-1B-Instruct_q4_block32_ekv4096.litertlm?download=true"
    }
}
