// 掲示板に出した投稿が、「外から」（ログインも Cookie も無い別のブラウザで）一覧に載って見えているかの確認。
//
// 自分のブラウザ（投稿に使う専用 Chrome）には、投稿した本人のセッションがある。掲示板によっては、制限された
// アカウントの投稿が、本人にだけ見えて、ほかの人には一覧に出ないことがある（2026-11-03 に Yay で起きた）。
// なので、投稿に使うブラウザとは別に、まっさらなブラウザを立ち上げて、トップの一覧を読む（約3秒）。
//
// 確かめられないとき（読み込めない・一覧が空・形が変わった）は「見えない」とは数えない。
// 誤って止めるより、確かめられないことを知らせて続けるほうを選ぶ（止めるのは、確かに載っていないときだけ）。

/** 一覧の中から探す目印。文の最初の（空でない）1行。短すぎる・長すぎる行は、そのまま使う。 */
export function snippetOf(text) {
  const line = String(text).split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.slice(0, 30);
}

/** 一覧の各投稿の文字列から、載っているかを判定する。articles は一覧の投稿の本文（innerText）の配列。 */
export function judgeBoard({ articles, snippet, minArticles = 8 }) {
  if (!snippet) return "unknown";
  if (!Array.isArray(articles) || articles.length < minArticles) return "unknown"; // 読めていない・形が違う
  return articles.some((a) => a.replace(/\s+/g, " ").includes(snippet.replace(/\s+/g, " "))) ? "visible" : "hidden";
}

/**
 * まっさらなヘッドレスブラウザで掲示板のトップを開き、投稿が載っているかを返す。
 * @returns {Promise<"visible"|"hidden"|"unknown">}
 */
export async function checkBoard({ chromium, url, text, selector = "article", retries = 1, retryWaitMs = 3000, timeoutMs = 20000 }) {
  const snippet = snippetOf(text);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      locale: "ja-JP",
    });
    const page = await ctx.newPage();
    for (let i = 0; i <= retries; i++) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForSelector(selector, { timeout: timeoutMs });
      const articles = await page.$$eval(selector, (els) => els.map((e) => e.innerText));
      const result = judgeBoard({ articles, snippet });
      // 出した直後は一覧に載るまで少しかかることがあるので、載っていなければ、少し待ってもう一度見る
      if (result !== "hidden" || i === retries) return result;
      await page.waitForTimeout(retryWaitMs);
    }
    return "unknown";
  } catch {
    return "unknown";
  } finally {
    await browser?.close().catch(() => {});
  }
}
