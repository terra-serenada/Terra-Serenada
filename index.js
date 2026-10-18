/**
 * Terra Serenada - Nara AI Guru Worker
 * Provider: Anoman AI (OpenAI-compatible API)
 * Required Cloudflare secret: ANOMAN_AI
 * Default model: gpt-4o-mini (unchanged; change only after checking model entitlement)
 *
 * Diagnostic update:
 * - Logs sanitized upstream errors under [NARA_UPSTREAM_ERROR].
 * - Includes safe diagnostic metadata in upstream error responses.
 * - Never logs API secrets, request bodies, or conversation contents.
 *
 * Routes:
 *   GET  /        Health check
 *   GET  /models  List models available to this Anoman API key
 *   POST /chat    Chat completion; JSON body: { "messages": [{"role":"user","content":"..."}] }
 */

const ANOMAN_BASE_URL = "https://api.anoman.io/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const ALLOWED_ORIGINS = new Set([
  "https://terra-serenada.github.io",
  "https://appassets.androidplatform.net",
]);
const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGES = 40;
const MAX_TOKENS = 2000;
const MAX_ERROR_TEXT = 500;

function corsHeaders(origin) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
}

function jsonResponse(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin),
  });
}

function getOrigin(request) {
  return request.headers.get("Origin");
}

function originAllowedForApi(request) {
  const origin = getOrigin(request);
  // This is an origin guard, not authentication. Keep ANOMAN_AI server-side.
  return Boolean(origin && ALLOWED_ORIGINS.has(origin));
}

function safeText(value, maxLength = MAX_ERROR_TEXT) {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/[\r\n\t]+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

function inferErrorType(code, fallbackType) {
  if (fallbackType) return fallbackType;
  if (code === "token_quota_exceeded" || code === "budget_exceeded" ||
      code === "insufficient_credits" || code === "insufficient_balance") {
    return "billing_error";
  }
  return undefined;
}

function extractUpstreamError(responseBody, status) {
  const outer = responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)
    ? responseBody : {};
  const detail = outer.detail && typeof outer.detail === "object" ? outer.detail : {};
  const data = outer.data && typeof outer.data === "object" ? outer.data : {};
  const nestedError = data.error && typeof data.error === "object" ? data.error : {};
  const err = outer.error && typeof outer.error === "object" ? outer.error : {};

  // Anoman responses may use the OpenAI-style {error:{...}} envelope, or
  // the quota envelope {detail:{error:"token_quota_exceeded", ...}}.
  const rawCode = err.code || detail.code || nestedError.code ||
    (typeof detail.error === "string" ? detail.error : undefined) ||
    (typeof outer.error === "string" ? outer.error : undefined) ||
    outer.code || data.code;
  const code = safeText(rawCode, 120);
  const type = safeText(err.type || detail.type || nestedError.type || outer.type, 120);
  const modelTierClass = safeText(detail.model_tier_class || outer.model_tier_class || data.model_tier_class, 80);
  const window = safeText(detail.window || outer.window || data.window, 40);
  let message = safeText(err.message || detail.message || nestedError.message || outer.message || data.message);

  if (!message && code === "token_quota_exceeded") {
    message = `Kuota token Anoman untuk kelas model ${modelTierClass || "yang digunakan"} telah tercapai${window ? ` pada periode ${window}` : ""}.`;
  } else if (!message && code === "budget_exceeded") {
    message = "Batas anggaran bulanan Anoman untuk API key ini telah tercapai.";
  } else if (!message && (code === "insufficient_credits" || code === "insufficient_balance")) {
    message = "Saldo atau kredit Anoman untuk permintaan ini tidak mencukupi.";
  } else if (!message && typeof outer.detail === "string") {
    message = safeText(outer.detail);
  }

  if (!message) message = "Anoman AI mengembalikan respons error tanpa pesan yang terbaca.";
  return {
    type: inferErrorType(code, type) || (status === 402 ? "billing_error" : undefined),
    code,
    message,
    modelTierClass: modelTierClass || undefined,
    window: window || undefined,
  };
}

function withDiagnostics(responseBody, diagnostics, errorInfo) {
  if (responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)) {
    const result = { ...responseBody, naraDiagnostics: diagnostics };
    // Keep the provider's error structure intact when it exists. If it does not,
    // supply a compatible error object so the client has a usable message.
    if (!result.error) {
      result.error = {
        type: errorInfo.type || "upstream_error",
        code: errorInfo.code || "upstream_error",
        message: errorInfo.message,
      };
    }
    return result;
  }
  return {
    error: {
      type: errorInfo.type || "upstream_error",
      code: errorInfo.code || "upstream_error",
      message: errorInfo.message,
    },
    naraDiagnostics: diagnostics,
  };
}

async function anomanFetch(path, env, init = {}, origin = null) {
  if (!env || !env.ANOMAN_AI) {
    console.error("[NARA_CONFIG_ERROR]", JSON.stringify({
      code: "missing_anoman_secret",
      route: path,
    }));
    return jsonResponse({
      error: {
        type: "configuration_error",
        code: "missing_anoman_secret",
        message: "Secret ANOMAN_AI belum disetel di Cloudflare Worker.",
      },
    }, 500, origin);
  }

  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${env.ANOMAN_AI}`);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");

  let upstream;
  try {
    upstream = await fetch(`${ANOMAN_BASE_URL}${path}`, {
      ...init,
      headers,
    });
  } catch (error) {
    const errorName = error && typeof error.name === "string" ? error.name : "FetchError";
    console.error("[NARA_UPSTREAM_NETWORK_ERROR]", JSON.stringify({
      provider: "Anoman AI",
      route: path,
      model: path === "/chat/completions" ? DEFAULT_MODEL : undefined,
      errorName: safeText(errorName, 80),
    }));
    return jsonResponse({
      error: {
        type: "upstream_network_error",
        code: "anoman_unreachable",
        message: "Tidak dapat terhubung ke layanan Anoman AI. Periksa kembali nanti.",
      },
      naraDiagnostics: {
        provider: "Anoman AI",
        route: path,
        model: path === "/chat/completions" ? DEFAULT_MODEL : null,
        upstreamStatus: null,
      },
    }, 502, origin);
  }

  const contentType = upstream.headers.get("Content-Type") || "";
  const providerRequestId = upstream.headers.get("x-request-id") ||
    upstream.headers.get("request-id") || null;
  const providerTier = upstream.headers.get("x-anoman-tier") || null;
  const providerRegion = upstream.headers.get("x-anoman-region") || null;
  const providerCache = upstream.headers.get("x-anoman-cache") || null;
  const responseText = await upstream.text();
  let responseBody;
  let jsonParsed = true;
  try {
    responseBody = responseText ? JSON.parse(responseText) : {};
  } catch (_error) {
    jsonParsed = false;
    responseBody = {};
  }

  const model = path === "/chat/completions" ? DEFAULT_MODEL : null;
  const diagnostics = {
    provider: "Anoman AI",
    route: path,
    upstreamStatus: upstream.status,
    model,
    providerRequestId: safeText(providerRequestId, 120) || null,
    providerTier: safeText(providerTier, 80) || null,
    providerRegion: safeText(providerRegion, 40) || null,
    providerCache: safeText(providerCache, 80) || null,
  };

  if (!jsonParsed) {
    const errorInfo = {
      type: "upstream_invalid_response",
      code: "non_json_response",
      message: "Anoman AI mengembalikan respons yang bukan JSON. Lihat status upstream dan Content-Type di log Worker.",
    };
    console.error("[NARA_UPSTREAM_INVALID_JSON]", JSON.stringify({
      ...diagnostics,
      contentType: safeText(contentType, 120) || null,
      responseBytes: new TextEncoder().encode(responseText).byteLength,
    }));
    const status = upstream.ok ? 502 : upstream.status;
    return jsonResponse(withDiagnostics({ error: errorInfo }, diagnostics, errorInfo), status, origin);
  }

  if (!upstream.ok) {
    const errorInfo = extractUpstreamError(responseBody, upstream.status);
    diagnostics.modelTierClass = errorInfo.modelTierClass || null;
    diagnostics.quotaWindow = errorInfo.window || null;
    // Deliberately omit request payloads, conversation text, authorization, and secrets.
    console.error("[NARA_UPSTREAM_ERROR]", JSON.stringify({
      ...diagnostics,
      errorType: errorInfo.type || null,
      errorCode: errorInfo.code || null,
      errorMessage: errorInfo.message,
      modelTierClass: errorInfo.modelTierClass || null,
      quotaWindow: errorInfo.window || null,
      responseTopLevelKeys: Object.keys(responseBody || {}).slice(0, 20),
      responseDetailKeys: responseBody && responseBody.detail && typeof responseBody.detail === "object"
        ? Object.keys(responseBody.detail).slice(0, 20) : [],
      contentType: safeText(contentType, 120) || null,
    }));
    return jsonResponse(withDiagnostics(responseBody, diagnostics, errorInfo), upstream.status, origin);
  }

  // Preserve the provider's successful response format for existing Nara clients.
  return jsonResponse(responseBody, upstream.status, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = getOrigin(request);

    if (request.method === "OPTIONS") {
      if (!origin || !ALLOWED_ORIGINS.has(origin)) {
        return jsonResponse({ error: "Origin tidak diizinkan." }, 403, origin);
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse({
        ok: true,
        service: "Terra Serenada - Nara AI Guru",
        provider: "Anoman AI",
        defaultModel: DEFAULT_MODEL,
        routes: ["GET /models", "POST /chat"],
      }, 200, origin);
    }

    if (request.method === "GET" && url.pathname === "/models") {
      return anomanFetch("/models", env, { method: "GET" }, origin);
    }

    if (request.method === "POST" && url.pathname === "/chat") {
      if (!originAllowedForApi(request)) {
        return jsonResponse({ error: "Origin tidak diizinkan untuk endpoint chat." }, 403, origin);
      }

      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return jsonResponse({ error: "Permintaan terlalu besar." }, 413, origin);
      }

      let body;
      try {
        body = JSON.parse(rawBody);
      } catch (_error) {
        return jsonResponse({ error: "Body harus berupa JSON yang valid." }, 400, origin);
      }

      if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
        return jsonResponse({ error: "Isi permintaan wajib memiliki array messages." }, 400, origin);
      }
      if (body.messages.length > MAX_MESSAGES) {
        return jsonResponse({ error: `Maksimal ${MAX_MESSAGES} pesan per permintaan.` }, 400, origin);
      }

      for (const message of body.messages) {
        if (!message || !["system", "user", "assistant"].includes(message.role) ||
            !(typeof message.content === "string" || Array.isArray(message.content))) {
          return jsonResponse({ error: "Format salah pada salah satu pesan." }, 400, origin);
        }
      }

      const payload = {
        model: DEFAULT_MODEL,
        messages: body.messages,
        temperature: typeof body.temperature === "number"
          ? Math.max(0, Math.min(1, body.temperature))
          : 0.3,
        max_tokens: MAX_TOKENS,
        stream: false,
      };

      return anomanFetch("/chat/completions", env, {
        method: "POST",
        body: JSON.stringify(payload),
      }, origin);
    }

    return jsonResponse({ error: "Rute tidak ditemukan." }, 404, origin);
  },
};
