import { SHARED_MODULE_NAME } from "@patto-md/shared";

/**
 * Cloudflare Workers API のエントリーポイント。
 */
export default {
  /**
   * HTTPリクエストを処理するハンドラー関数。
   *
   * @param request - 受信したHTTPリクエスト。
   * @returns レスポンスオブジェクト。
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", module: SHARED_MODULE_NAME }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response("Not Found", { status: 404 });
  },
};
