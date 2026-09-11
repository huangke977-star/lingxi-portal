# P23 AI Gateway Guide

## Entry And Permissions

After signing in, a super administrator can open `Admin -> AI settings`. Regular administrators cannot read or change AI settings and cannot view invocation records.

## Connection Settings

- Provider: choose `OpenAI Compatible`, `Anthropic`, or `Google`.
- Base URL: enter the provider API root without an API key.
  - OpenAI-compatible: for example `https://api.openai.com/v1`; the gateway calls `/chat/completions`.
  - Anthropic: for example `https://api.anthropic.com`; the gateway calls `/v1/messages`.
  - Google: for example `https://generativelanguage.googleapis.com/v1beta`; the gateway calls the selected model's `:generateContent` endpoint.
- Model: enter the provider's actual model ID.
- API key: sent only to the server and encrypted at rest; the original value is never returned to the browser. Leave it blank when saving to keep the existing key.
- Enable AI: user-facing assistants send requests only after a complete configuration is saved and enabled. Connection testing does not require the enable switch to be on.

Save the settings and click `Test connection`. A successful test reports latency and creates a redacted invocation record. Failures expose only a safe HTTP status or connection error, never the provider response body.

## Resource Protection

- Global concurrency: the maximum number of AI requests in flight across the site. The current server recommends 2.
- Per-user concurrency: the maximum number of simultaneous requests for one account. The recommended value is 1.
- Max output tokens: caps each response to prevent unexpectedly long resource usage.
- Request timeout: aborts slow calls. Acquired concurrency is released in `finally`, with a Redis lease expiry as a fallback.
- Global daily request limit: counts all site requests by UTC date; 0 means unlimited. Releasing concurrency does not refund a consumed daily quota.

Keep the initial values at global 2, per-user 1, 60 seconds, and 2,000 output tokens. The server does not run a local model or keep Ollama, a vector database, or another AI service resident.

## Usage And Cost

When a provider returns token usage, the gateway stores input, output, and total tokens. Enter input and output prices per million tokens; for example, `0.15` means 0.15 units of the selected currency per million tokens. A price of 0 records tokens without estimating cost. The gateway stores micro-units internally and never stores prompts, generated text, or API keys in the log.

Invocation records help diagnose connection failures, timeouts, quotas, and provider errors. Errors are truncated to a safe summary; operation names should not contain passwords, tokens, or other sensitive values.

## Article Writing Assistant

Signed-in users can open `AI writing assistant` from the writing editor toolbar. It supports:

- title, outline, and summary generation;
- category and tag suggestions;
- polishing, rewriting, expanding, shortening, and correcting the body;
- Markdown formatting assistance.

The assistant sends the current title, body, category, and tags as context to the configured external model. When a passage is selected before opening the assistant, body actions prioritize that passage for polishing, rewriting, expanding, shortening, correcting, and formatting. Results appear in a preview first and do not change the article automatically. After `Apply result`, a title, summary, or taxonomy suggestion updates the editor state; body results are inserted at the current editor selection. The author must still review the content and manually save or publish it. When AI is disabled, incomplete, over its concurrency limit, or over its daily quota, the page shows the corresponding message.

Body results are parsed as Markdown before insertion and still pass through the existing article save, content-normalization, and publish-check flow. Authors should verify generated facts, links, and code. Prompts and generated text are never written to the AI invocation log.
