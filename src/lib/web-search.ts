export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

type SearchResponse = {
  ok: boolean;
  message: string;
  query: string;
  results: WebSearchHit[];
};

async function searchTavily(query: string, apiKey: string): Promise<SearchResponse> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 5,
      search_depth: "basic",
      include_answer: true,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return {
      ok: false,
      message: `Web search failed: ${err.slice(0, 120)}`,
      query,
      results: [],
    };
  }

  const data = (await response.json()) as {
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  const results: WebSearchHit[] = (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content?.slice(0, 400) ?? "",
  }));

  const answer = data.answer?.trim();
  const message =
    answer ||
    (results.length > 0
      ? `Found ${results.length} result(s) for “${query}”.`
      : `No results for “${query}”.`);

  return { ok: true, message, query, results };
}

async function searchSerper(query: string, apiKey: string): Promise<SearchResponse> {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: 5 }),
  });

  if (!response.ok) {
    const err = await response.text();
    return {
      ok: false,
      message: `Web search failed: ${err.slice(0, 120)}`,
      query,
      results: [],
    };
  }

  const data = (await response.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    knowledgeGraph?: { title?: string; description?: string };
  };

  const results: WebSearchHit[] = (data.organic ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.link ?? "",
    snippet: r.snippet ?? "",
  }));

  if (data.knowledgeGraph?.description) {
    results.unshift({
      title: data.knowledgeGraph.title ?? query,
      url: "",
      snippet: data.knowledgeGraph.description,
    });
  }

  return {
    ok: true,
    message: results.length > 0 ? `Found ${results.length} result(s) for “${query}”.` : `No results for “${query}”.`,
    query,
    results,
  };
}

export async function searchWeb(query: string): Promise<SearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, message: "Search query required.", query: "", results: [] };
  }

  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  if (tavilyKey) return searchTavily(trimmed, tavilyKey);

  const serperKey = process.env.SERPER_API_KEY?.trim();
  if (serperKey) return searchSerper(trimmed, serperKey);

  return {
    ok: false,
    message:
      "Web search not configured — add TAVILY_API_KEY (tavily.com, free tier) or SERPER_API_KEY to Vercel env.",
    query: trimmed,
    results: [],
  };
}
