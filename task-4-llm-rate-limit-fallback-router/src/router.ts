const PRIMARY_TIMEOUT_MS = 3000;

export class GatewayError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

interface CompletionRequest {
  mode?: string;
}

interface CompletionResult {
  provider: string;
  text: string;
}

async function callProvider(url: string, body: CompletionRequest, timeoutMs?: number): Promise<CompletionResult> {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 429) {
      throw new GatewayError("rate_limited", `Provider at ${url} returned 429`);
    }
    if (!res.ok) {
      throw new GatewayError("provider_error", `Provider at ${url} returned ${res.status}`);
    }
    return (await res.json()) as CompletionResult;
  } catch (err) {
    if (err instanceof GatewayError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new GatewayError("timeout", `Provider at ${url} timed out after ${timeoutMs}ms`);
    }
    throw new GatewayError("network_error", `Provider at ${url} unreachable: ${(err as Error).message}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function routeCompletion(
  primaryUrl: string,
  secondaryUrl: string,
  primaryBody: CompletionRequest,
  secondaryBody: CompletionRequest = {},
): Promise<CompletionResult> {
  try {
    return await callProvider(primaryUrl, primaryBody, PRIMARY_TIMEOUT_MS);
  } catch (primaryErr) {
    try {
      return await callProvider(secondaryUrl, secondaryBody);
    } catch (secondaryErr) {
      throw new GatewayError(
        "all_providers_failed",
        `Primary failed (${(primaryErr as GatewayError).code}), secondary failed (${(secondaryErr as GatewayError).code})`,
      );
    }
  }
}
