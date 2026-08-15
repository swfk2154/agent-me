"""联网搜索服务 —— 多后端：DuckDuckGo / Tavily / Brave / SerpAPI / Serper / SearXNG / 自定义"""
import warnings
from typing import Optional
import httpx
from app_config.search_providers import SEARCH_PROVIDERS
from app_config.settings import CONFIG_DIR
from app_config.encryption import ConfigEncryption

_encrypt = ConfigEncryption(CONFIG_DIR)
warnings.filterwarnings("ignore")

HAS_DDGS = False
try:
    from ddgs import DDGS
    HAS_DDGS = True
except ImportError:
    try:
        from duckduckgo_search import DDGS
        HAS_DDGS = True
    except ImportError:
        pass


def _get_active_provider() -> tuple[str, dict]:
    config = _encrypt.load_config()
    search_cfg = config.get("_search", {})
    active = search_cfg.get("active_provider", "duckduckgo")
    if active == "duckduckgo":
        return "duckduckgo", {}
    if active in SEARCH_PROVIDERS:
        api_key = search_cfg.get("providers", {}).get(active, {}).get("api_key", "")
        base_url = search_cfg.get("providers", {}).get(active, {}).get("base_url", "")
        return active, {"api_key": api_key, "base_url": base_url}
    return "duckduckgo", {}


def _search_ddg(query: str, max_results: int = 5) -> list[dict]:
    if not HAS_DDGS:
        return _search_ddg_html(query, max_results)
    try:
        ddgs = DDGS(timeout=15)
        results = ddgs.text(query, max_results=max_results)
        if not results:
            return _search_ddg_html(query, max_results)
        return [{"title": r.get("title", ""), "snippet": r.get("body", r.get("snippet", "")),
                 "url": r.get("href", r.get("url", ""))} for r in results]
    except Exception as e:
        return [{"title": "DDGS 搜索失败", "snippet": str(e), "url": ""}]


def _search_ddg_html(query: str, max_results: int = 5) -> list[dict]:
    import re
    from urllib.request import Request, urlopen
    from urllib.parse import quote_plus
    url = f"https://lite.duckduckgo.com/lite/?q={quote_plus(query)}"
    try:
        req = Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        return [{"title": "搜索失败", "snippet": str(e), "url": ""}]
    results = []
    pattern = re.compile(
        r'<a\s+rel="nofollow"\s+href="([^"]+)"[^>]*class="result-link"[^>]*>([^<]+)</a>'
        r'.*?<td class="result-snippet"[^>]*>(.*?)</td>', re.DOTALL)
    for href, title, snippet in pattern.findall(html)[:max_results]:
        results.append({"title": title.strip(), "snippet": re.sub(r'<[^>]+>', '', snippet).strip(), "url": href})
    return results


def _search_tavily(query: str, api_key: str, max_results: int = 5) -> list[dict]:
    try:
        resp = httpx.post("https://api.tavily.com/search",
            json={"query": query, "api_key": api_key, "max_results": max_results, "search_depth": "basic"}, timeout=15)
        data = resp.json()
        return [{"title": r.get("title", ""), "snippet": r.get("content", ""), "url": r.get("url", "")}
                for r in data.get("results", [])]
    except Exception as e:
        return [{"title": "Tavily 搜索失败", "snippet": str(e), "url": ""}]


def _search_brave(query: str, api_key: str, max_results: int = 5) -> list[dict]:
    try:
        resp = httpx.get("https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": min(max_results, 10)},
            headers={"Accept": "application/json", "X-Subscription-Token": api_key}, timeout=15)
        data = resp.json()
        return [{"title": r.get("title", ""), "snippet": r.get("description", ""), "url": r.get("url", "")}
                for r in data.get("web", {}).get("results", [])]
    except Exception as e:
        return [{"title": "Brave 搜索失败", "snippet": str(e), "url": ""}]


def _search_bing(query: str, api_key: str, max_results: int = 5) -> list[dict]:
    try:
        resp = httpx.get("https://api.bing.microsoft.com/v7.0/search",
            params={"q": query, "count": max_results, "mkt": "zh-CN"},
            headers={"Ocp-Apim-Subscription-Key": api_key}, timeout=15)
        data = resp.json()
        results = []
        for r in data.get("webPages", {}).get("value", [])[:max_results]:
            results.append({
                "title": r.get("name", ""),
                "snippet": r.get("snippet", ""),
                "url": r.get("url", ""),
            })
        return results
    except Exception as e:
        return [{"title": "Bing 搜索失败", "snippet": str(e), "url": ""}]


def _search_serpapi(query: str, api_key: str, max_results: int = 5) -> list[dict]:
    try:
        resp = httpx.get("https://serpapi.com/search",
            params={"q": query, "api_key": api_key, "num": max_results, "engine": "google"}, timeout=15)
        data = resp.json()
        return [{"title": r.get("title", ""), "snippet": r.get("snippet", ""), "url": r.get("link", "")}
                for r in data.get("organic_results", [])[:max_results]]
    except Exception as e:
        return [{"title": "SerpAPI 搜索失败", "snippet": str(e), "url": ""}]


def _search_serper(query: str, api_key: str, max_results: int = 5) -> list[dict]:
    try:
        resp = httpx.post("https://google.serper.dev/search",
            json={"q": query, "num": max_results},
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"}, timeout=15)
        data = resp.json()
        return [{"title": r.get("title", ""), "snippet": r.get("snippet", ""), "url": r.get("link", "")}
                for r in data.get("organic", [])[:max_results]]
    except Exception as e:
        return [{"title": "Serper 搜索失败", "snippet": str(e), "url": ""}]


def _search_searxng(query: str, base_url: str, api_key: str = "", max_results: int = 5) -> list[dict]:
    try:
        url = (base_url or "http://localhost:8080/search").rstrip("/") + "?format=json"
        headers = {"User-Agent": "agent-me/2.0"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        resp = httpx.get(url, params={"q": query, "categories": "general", "pageno": 1}, headers=headers, timeout=15)
        data = resp.json()
        results = []
        for r in data.get("results", [])[:max_results]:
            results.append({"title": r.get("title", ""), "snippet": r.get("content", r.get("snippet", "")), "url": r.get("url", "")})
        return results
    except Exception as e:
        return [{"title": "SearXNG 搜索失败", "snippet": str(e), "url": ""}]


def _search_custom(query: str, base_url: str, api_key: str = "", max_results: int = 5) -> list[dict]:
    try:
        headers = {"Content-Type": "application/json", "User-Agent": "agent-me/2.0"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        resp = httpx.post(base_url, json={"query": query, "max_results": max_results}, headers=headers, timeout=15)
        data = resp.json()
        results_list = data.get("results") or data.get("data") or []
        return [{"title": r.get("title", ""), "snippet": r.get("snippet", r.get("content", "")), "url": r.get("url", r.get("link", ""))}
                for r in results_list[:max_results]]
    except Exception as e:
        return [{"title": "自定义搜索失败", "snippet": str(e), "url": ""}]


def search_web(query: str, max_results: int = 5) -> list[dict]:
    """搜索互联网，失败时自动重试最多 2 次"""
    provider, cfg = _get_active_provider()
    api_key = cfg.get("api_key", "")
    base_url = cfg.get("base_url", "")

    # 选择搜索函数
    if provider == "tavily" and api_key:
        search_fn = lambda: _search_tavily(query, api_key, max_results)
    elif provider == "brave" and api_key:
        search_fn = lambda: _search_brave(query, api_key, max_results)
    elif provider == "bing" and api_key:
        search_fn = lambda: _search_bing(query, api_key, max_results)
    elif provider == "serpapi" and api_key:
        search_fn = lambda: _search_serpapi(query, api_key, max_results)
    elif provider == "serper" and api_key:
        search_fn = lambda: _search_serper(query, api_key, max_results)
    elif provider == "searxng":
        search_fn = lambda: _search_searxng(query, base_url, api_key, max_results)
    elif provider == "custom" and base_url:
        search_fn = lambda: _search_custom(query, base_url, api_key, max_results)
    else:
        search_fn = lambda: _search_ddg(query, max_results)

    # 执行搜索，失败重试
    import time
    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        try:
            results = search_fn()
            if results and "失败" not in results[0].get("title", ""):
                return results
            # 第一次失败：等 1 秒重试；第二次失败：等 2 秒重试后换备用
            if attempt < max_attempts:
                time.sleep(attempt)
        except Exception:
            if attempt < max_attempts:
                time.sleep(attempt)

    # 全部失败，启用 DuckDuckGo HTML 模式作为备用
    try:
        return _search_ddg_html(query, max_results)
    except Exception:
        pass

    return []


def format_search_context(query: str, max_results: int = 5) -> str:
    try:
        results = search_web(query, max_results)
    except Exception:
        results = []
    if not results:
        results = _search_ddg_html(query, max_results)
    if not results:
        return ""
    provider_name = SEARCH_PROVIDERS.get(_get_active_provider()[0], {}).get("name", "搜索")
    lines = [f"[联网搜索结果 — {provider_name}]"]
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {r['title']}")
        if r.get("snippet"):
            lines.append(f"   {r['snippet'][:300]}")
        if r.get("url"):
            lines.append(f"   来源: {r['url']}")
    return "\n".join(lines)


def test_search_connection(provider_key: str, api_key: str = "", base_url: str = "") -> tuple[bool, str]:
    if provider_key == "duckduckgo" or not provider_key:
        if HAS_DDGS:
            results = _search_ddg("test", max_results=2)
            ok = len(results) > 0 and "失败" not in (results[0].get("title", "") if results else "")
            return ok, f"DuckDuckGo 连接正常 ({len(results)} 结果)" if ok else "DuckDuckGo 无结果，检查网络"
        results = _search_ddg_html("test", max_results=2)
        ok = len(results) > 0 and "失败" not in (results[0].get("title", "") if results else "")
        return ok, f"DuckDuckGo HTML 模式 ({len(results)} 结果)" if ok else "DuckDuckGo 无响应"
    elif provider_key == "tavily" and api_key:
        results = _search_tavily("test", api_key, max_results=1)
        ok = len(results) > 0 and "失败" not in results[0].get("title", "")
        return ok, "Tavily 连接正常" if ok else "无结果"
    elif provider_key == "brave" and api_key:
        results = _search_brave("test", api_key, max_results=1)
        ok = len(results) > 0 and "失败" not in results[0].get("title", "")
        return ok, "Brave 连接正常" if ok else "无结果"
    elif provider_key == "bing" and api_key:
        results = _search_bing("test", api_key, max_results=1)
        ok = len(results) > 0 and "失败" not in results[0].get("title", "")
        return ok, "Bing 连接正常" if ok else "无结果"
    elif provider_key == "serpapi" and api_key:
        results = _search_serpapi("test", api_key, max_results=1)
        ok = len(results) > 0 and "失败" not in results[0].get("title", "")
        return ok, "SerpAPI 连接正常" if ok else "无结果"
    elif provider_key == "serper" and api_key:
        results = _search_serper("test", api_key, max_results=1)
        ok = len(results) > 0 and "失败" not in results[0].get("title", "")
        return ok, "Serper 连接正常" if ok else "无结果"
    elif provider_key == "searxng":
        results = _search_searxng("test", base_url, api_key, max_results=1)
        ok = len(results) > 0 and "失败" not in results[0].get("title", "")
        return ok, "SearXNG 连接正常" if ok else "无结果"
    elif provider_key == "custom" and base_url:
        results = _search_custom("test", base_url, api_key, max_results=1)
        ok = len(results) > 0 and "失败" not in results[0].get("title", "")
        return ok, "自定义搜索连接正常" if ok else "无结果"
    return False, "未知提供商或缺少 API Key/URL"


def get_search_config() -> dict:
    config = _encrypt.load_config()
    search_cfg = config.get("_search", {})
    active = search_cfg.get("active_provider", "duckduckgo")
    providers = {}
    for key in SEARCH_PROVIDERS:
        stored = search_cfg.get("providers", {}).get(key, {})
        providers[key] = {
            "api_key": stored.get("api_key", ""),
            "base_url": stored.get("base_url", SEARCH_PROVIDERS[key].get("base_url", "")),
            "enabled": key == "duckduckgo" or bool(stored.get("api_key", "") or stored.get("base_url", "")),
        }
    return {"active_provider": active, "providers": providers}


def save_search_config(active_provider: str, provider_configs: dict) -> None:
    config = _encrypt.load_config()
    config["_search"] = {"active_provider": active_provider, "providers": provider_configs}
    _encrypt.save_config(config)
