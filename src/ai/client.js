const OpenAI = require("openai");

const PROVIDERS = {
  openai: {
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    envVar: "OPENAI_API_KEY",
    protocol: "openai",
  },
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.5-flash",
    envVar: "GEMINI_API_KEY",
    protocol: "openai",
  },
  claude: {
    baseURL: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-5-20250929",
    envVar: "ANTHROPIC_API_KEY",
    protocol: "anthropic",
  },
};

/**
 * Create a client handle for the given provider.
 * OpenAI/Gemini use the openai SDK; Claude uses native fetch to the Messages API.
 *
 * @param {string} provider - "openai" | "gemini" | "claude"
 * @param {{ model?: string, baseURL?: string }} options
 * @returns {{ provider: string, protocol: string, client?: OpenAI, apiKey: string, baseURL: string, model: string }}
 */
function createClient(provider, options = {}) {
  const config = PROVIDERS[provider];
  if (!config) {
    throw new Error(
      `Unknown AI provider: "${provider}". Supported: ${Object.keys(PROVIDERS).join(", ")}`
    );
  }

  const apiKey = process.env[config.envVar];
  if (!apiKey) {
    throw new Error(
      `Missing API key: set ${config.envVar} environment variable for provider "${provider}"`
    );
  }

  const model = options.model || config.defaultModel;
  let baseURL = config.baseURL;

  if (options.baseURL) {
    // User-supplied base URL: use as-is if it ends with /, otherwise append path suffix
    if (options.baseURL.endsWith("/")) {
      baseURL = options.baseURL;
    } else if (config.protocol === "anthropic") {
      // Anthropic endpoints don't use /v1 — the path is /v1/messages appended by chat()
      baseURL = options.baseURL;
    } else {
      baseURL = options.baseURL + "/v1";
    }
  }

  if (config.protocol === "openai") {
    const client = new OpenAI({ apiKey, baseURL });
    return { provider, protocol: "openai", client, apiKey, baseURL, model };
  }

  // Anthropic: no SDK, store connection info for native fetch in chat()
  return { provider, protocol: "anthropic", apiKey, baseURL, model };
}

/**
 * Send a chat request with retry on 429.
 * Routes to OpenAI SDK or Anthropic Messages API based on protocol.
 *
 * @param {{ protocol: string, client?: OpenAI, apiKey: string, baseURL: string }} handle
 * @param {string} model
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>}
 */
async function chat(handle, model, systemPrompt, userPrompt) {
  if (handle.protocol === "openai") {
    return chatOpenAI(handle.client, model, systemPrompt, userPrompt);
  }
  return chatAnthropic(handle, model, systemPrompt, userPrompt);
}

/** OpenAI-compatible chat (works for openai + gemini) */
async function chatOpenAI(client, model, systemPrompt, userPrompt) {
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      return stripCodeFences(response.choices[0].message.content || "");
    } catch (err) {
      if (err.status === 429 && attempt < MAX_RETRIES - 1) {
        await retryDelay(attempt);
        continue;
      }
      throw err;
    }
  }
}

/** Anthropic Messages API via native fetch */
async function chatAnthropic(handle, model, systemPrompt, userPrompt) {
  const MAX_RETRIES = 3;
  const url = handle.baseURL.replace(/\/+$/, "") + "/v1/messages";

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": handle.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (res.status === 429 && attempt < MAX_RETRIES - 1) {
      await retryDelay(attempt);
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    // Anthropic response: { content: [{ type: "text", text: "..." }] }
    const text = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return stripCodeFences(text);
  }
}

function stripCodeFences(text) {
  return text
    .replace(/^```(?:javascript|js)?\n?/m, "")
    .replace(/\n?```$/m, "")
    .trim();
}

async function retryDelay(attempt) {
  const delay = Math.pow(2, attempt + 1) * 1000;
  process.stderr.write(
    `[ai] Rate limited, retrying in ${delay / 1000}s (attempt ${attempt + 1}/3)...\n`
  );
  await new Promise((resolve) => setTimeout(resolve, delay));
}

module.exports = { createClient, chat };
