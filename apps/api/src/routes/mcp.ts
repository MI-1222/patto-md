/**
 * Model Context Protocol (MCP) Streamable HTTP エンドポイント。
 *
 * 公式 `@modelcontextprotocol/sdk` の `McpServer` および
 * `WebStandardStreamableHTTPServerTransport` を利用し、Cloudflare Workers 上で
 * 完全ステートレスに動作する Remote MCP サーバーを提供する。
 *
 * 全リクエストに対してパーソナルアクセストークン(PAT)による認証を必須とし、
 * ドキュメントの新規公開(`publish_document`)、更新(`update_document`)、
 * および取得(`get_document`)の3つのツールを公開する。
 */

import {
  MAX_SINGLE_FILE_SIZE,
  mcpGetDocumentSchema,
  mcpPublishDocumentSchema,
  mcpUpdateDocumentSchema,
} from '@patto-md/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import {
  decodeBase64Image,
  replaceMarkdownAssetPaths,
  resolvePublicUrl,
  sanitizeMcpFileName,
  type AssetPathMapping,
} from '../lib/mcp.ts';
import { hashPasscode, verifyPasscode } from '../lib/passcode.ts';
import { parseUserId } from '../lib/pat.ts';
import {
  getExpirationPrefix,
  getR2Text,
  resolveDocumentExpectedPrefix,
} from '../lib/r2.ts';
import { createDocument, SlugCollisionError } from '../lib/document-store.ts';
import { createPatAuthMiddleware } from '../middlewares/pat-auth.ts';
import type { AppEnv, AuthenticatedDocument } from '../types.ts';

/** MCP 関連エンドポイントのサブルーター。 */
export const mcpRouter = new Hono<AppEnv>();

mcpRouter.use('*', createPatAuthMiddleware({ required: true }));

/**
 * GET リクエストの拒否ハンドラー。
 *
 * 本サーバーは Cloudflare Workers の完全ステートレス運用を維持するため、
 * 常時持続ストリーム(SSE)を排し、Streamable HTTP POST のみを受け付ける。
 */
mcpRouter.get('/', (c) => {
  return c.text(
    'Method Not Allowed: patto-md MCP はステートレス HTTP POST のみ対応しています。',
    405,
  );
});

/**
 * リクエストの `Accept` ヘッダーを検証し、SDK 要件を満たすよう補完した `Request` を構築する。
 *
 * `@modelcontextprotocol/sdk` の `WebStandardStreamableHTTPServerTransport` は、
 * POST リクエスト時に `Accept` ヘッダーへ `application/json` と `text/event-stream` の
 * 双方が含まれていることを要求する。各種クライアントの実装差異を吸収するため、
 * 不足している場合はヘッダーを安全に補完する。
 *
 * @param req - クライアントからの生のリクエスト。
 * @returns 補正済み `Request` インスタンス。
 */
function normalizeMcpRequest(req: Request): Request {
  const accept = req.headers.get('accept') || '';
  const needsJson = !accept.includes('application/json');
  const needsSse = !accept.includes('text/event-stream');

  if (!needsJson && !needsSse) {
    return req;
  }

  const newHeaders = new Headers(req.headers);
  newHeaders.set('accept', 'application/json, text/event-stream');

  return new Request(req, { headers: newHeaders });
}

/**
 * MCP リクエスト処理ハンドラー。
 *
 * リクエスト毎に使い捨ての `McpServer` および `WebStandardStreamableHTTPServerTransport` を構築し、
 * 単一の JSON-RPC 2.0 リクエストを処理してレスポンスを返却する。
 */
mcpRouter.post('/', async (c) => {
  const patUser = c.get('patUser');
  if (!patUser) {
    return c.json(
      {
        error: {
          message: 'PAT認可情報が解決されていません。',
        },
      },
      401,
    );
  }

  const server = new McpServer({
    name: 'patto-md',
    version: '1.0.0',
  });

  server.registerTool(
    'publish_document',
    {
      description:
        'Markdownドキュメントおよび添付画像を patto-md へ新規公開し、閲覧用パーマリンクURLを発行します。',
      inputSchema: mcpPublishDocumentSchema.shape,
    },
    async (params) => {
      if (!patUser.scopes.includes('documents:write')) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: '操作に必要な権限(スコープ: documents:write)がありません。',
            },
          ],
        };
      }

      const {
        title,
        content,
        description,
        expiration,
        visibility,
        passcode,
        images = [],
      } = params;

      const expectedPrefix = getExpirationPrefix(expiration);
      const docUuid = crypto.randomUUID();
      const contentR2Key = `${expectedPrefix}uploads/${docUuid}/content.md`;
      const createdAt = new Date().toISOString();

      const pathMappings: AssetPathMapping[] = [];
      const attachmentRecords: Array<{
        id: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
        r2Key: string;
      }> = [];

      if (images.length > 0) {
        const preparedImages: Array<{
          originalPath: string;
          fileId: string;
          fileName: string;
          mimeType: string;
          r2Key: string;
          buffer: Uint8Array;
        }> = [];

        for (const img of images) {
          const buffer = decodeBase64Image(img.base64Data);
          if (buffer.byteLength > MAX_SINGLE_FILE_SIZE) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `画像「${img.path}」のデコード後サイズが上限を超過しています。`,
                },
              ],
            };
          }

          const fileId = crypto.randomUUID();
          const fileName = sanitizeMcpFileName(img.path);
          const r2Key = `${expectedPrefix}uploads/${fileId}/${fileName}`;

          preparedImages.push({
            originalPath: img.path,
            fileId,
            fileName,
            mimeType: img.mimeType,
            r2Key,
            buffer,
          });
        }

        try {
          await Promise.all(
            preparedImages.map((img) =>
              c.env.BUCKET.put(img.r2Key, img.buffer, {
                httpMetadata: { contentType: img.mimeType },
              }),
            ),
          );

          for (const img of preparedImages) {
            pathMappings.push({
              originalPath: img.originalPath,
              r2Key: img.r2Key,
            });
            attachmentRecords.push({
              id: img.fileId,
              fileName: img.fileName,
              fileSize: img.buffer.byteLength,
              mimeType: img.mimeType,
              r2Key: img.r2Key,
            });
          }
        } catch (error) {
          console.error('MCP 画像アップロードエラー:', error);
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: '画像の保存処理中にエラーが発生しました。',
              },
            ],
          };
        }
      }

      const finalMarkdown = replaceMarkdownAssetPaths(content, pathMappings);

      try {
        await c.env.BUCKET.put(contentR2Key, finalMarkdown, {
          httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
        });
      } catch (error) {
        console.error('MCP 本文保存エラー:', error);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Markdown 本文の保存処理中にエラーが発生しました。',
            },
          ],
        };
      }

      const parsedUser = parseUserId(patUser.userId);
      const ownerUserId = parsedUser?.providerUserId ?? null;
      const ownerProvider = parsedUser?.provider ?? null;

      let createResult;
      try {
        createResult = await createDocument(c.env.DB, {
          title,
          description,
          contentR2Key,
          expiration,
          visibility,
          passcode,
          ownerUserId,
          ownerProvider,
          attachments: attachmentRecords,
          createdAt,
        });
      } catch (error) {
        if (error instanceof SlugCollisionError) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'ドキュメントIDの採番に失敗しました。時間をおいて再試行してください。',
              },
            ],
          };
        }

        console.error('MCP D1 書き込みエラー:', error);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'ドキュメント情報の永続化に失敗しました。',
            },
          ],
        };
      }

      const publicUrl = resolvePublicUrl(
        c.req.url,
        c.env.FRONTEND_ORIGIN,
        createResult.slug,
      );

      return {
        content: [
          {
            type: 'text',
            text: [
              'ドキュメントを正常に公開しました。',
              '',
              `- タイトル: ${title}`,
              `- 公開URL: ${publicUrl}`,
              `- ドキュメントID: ${createResult.slug}`,
              `- 公開範囲: ${visibility}`,
              `- 有効期限: ${createResult.expiresAt ?? '無期限'}`,
              images.length > 0 ? `- 添付画像数: ${images.length}件` : null,
              '',
              'このパーマリンクを共有することでWebブラウザから閲覧可能です。',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      };
    },
  );

  server.registerTool(
    'update_document',
    {
      description:
        '既存のドキュメントの Markdown 本文やタイトル、メタデータを更新します。自身の PAT で作成したドキュメントのみ更新可能です。',
      inputSchema: mcpUpdateDocumentSchema.shape,
    },
    async (params) => {
      if (!patUser.scopes.includes('documents:write')) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: '操作に必要な権限(スコープ: documents:write)がありません。',
            },
          ],
        };
      }

      const {
        id,
        content,
        title,
        description,
        visibility,
        passcode,
        images = [],
      } = params;

      const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?')
        .bind(id)
        .first<AuthenticatedDocument>();

      if (!doc || doc.status === 'deleted') {
        return {
          isError: true,
          content: [{ type: 'text', text: 'ドキュメントが見つかりません。' }],
        };
      }

      if (doc.status === 'suspended') {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'このドキュメントは規約違反または通報により凍結されています。',
            },
          ],
        };
      }

      if (doc.expires_at && new Date(doc.expires_at).getTime() < Date.now()) {
        return {
          isError: true,
          content: [
            { type: 'text', text: 'このドキュメントは有効期限切れです。' },
          ],
        };
      }

      const parsedUser = parseUserId(patUser.userId);
      if (
        !parsedUser ||
        doc.owner_user_id !== parsedUser.providerUserId ||
        doc.owner_provider !== parsedUser.provider
      ) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'このドキュメントの更新権限がありません(所有者が一致しません)。',
            },
          ],
        };
      }

      const expectedPrefix = resolveDocumentExpectedPrefix(doc);
      const pathMappings: AssetPathMapping[] = [];
      const newAttachments: Array<{
        id: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
        r2Key: string;
      }> = [];

      if (images.length > 0) {
        const preparedImages: Array<{
          originalPath: string;
          fileId: string;
          fileName: string;
          mimeType: string;
          r2Key: string;
          buffer: Uint8Array;
        }> = [];

        for (const img of images) {
          const buffer = decodeBase64Image(img.base64Data);
          if (buffer.byteLength > MAX_SINGLE_FILE_SIZE) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `画像「${img.path}」のサイズが上限を超過しています。`,
                },
              ],
            };
          }

          const fileId = crypto.randomUUID();
          const fileName = sanitizeMcpFileName(img.path);
          const r2Key = `${expectedPrefix}uploads/${fileId}/${fileName}`;

          preparedImages.push({
            originalPath: img.path,
            fileId,
            fileName,
            mimeType: img.mimeType,
            r2Key,
            buffer,
          });
        }

        try {
          await Promise.all(
            preparedImages.map((img) =>
              c.env.BUCKET.put(img.r2Key, img.buffer, {
                httpMetadata: { contentType: img.mimeType },
              }),
            ),
          );

          for (const img of preparedImages) {
            pathMappings.push({
              originalPath: img.originalPath,
              r2Key: img.r2Key,
            });
            newAttachments.push({
              id: img.fileId,
              fileName: img.fileName,
              fileSize: img.buffer.byteLength,
              mimeType: img.mimeType,
              r2Key: img.r2Key,
            });
          }
        } catch (error) {
          console.error('MCP 追加画像保存エラー:', error);
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: '追加画像の保存中にエラーが発生しました。',
              },
            ],
          };
        }
      }

      const finalMarkdown = replaceMarkdownAssetPaths(content, pathMappings);

      try {
        await c.env.BUCKET.put(doc.content_r2_key, finalMarkdown, {
          httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
        });
      } catch (error) {
        console.error('MCP 本文更新エラー:', error);
        return {
          isError: true,
          content: [
            { type: 'text', text: 'Markdown 本文の更新に失敗しました。' },
          ],
        };
      }

      const nextTitle = title !== undefined ? title : doc.title;
      const nextDescription =
        description !== undefined ? description || null : doc.description;
      const nextVisibility =
        visibility !== undefined ? visibility : doc.visibility;

      let nextPasscodeHash = doc.passcode_hash;
      if (visibility === 'protected' && passcode) {
        nextPasscodeHash = await hashPasscode(passcode);
      } else if (visibility && visibility !== 'protected') {
        nextPasscodeHash = null;
      }

      const updatedAt = new Date().toISOString();

      const updateDocStatement = c.env.DB.prepare(
        `UPDATE documents SET
          title = ?,
          description = ?,
          visibility = ?,
          passcode_hash = ?,
          updated_at = ?
        WHERE id = ?`,
      ).bind(
        nextTitle,
        nextDescription,
        nextVisibility,
        nextPasscodeHash,
        updatedAt,
        id,
      );

      const existingAttachments = await c.env.DB.prepare(
        'SELECT id, r2_key FROM attachments WHERE document_id = ?',
      )
        .bind(id)
        .all<{ id: string; r2_key: string }>();

      const unusedAttachmentIds: string[] = [];
      for (const att of existingAttachments.results ?? []) {
        if (!finalMarkdown.includes(att.r2_key)) {
          unusedAttachmentIds.push(att.id);
        }
      }

      const deleteUnusedStatements = unusedAttachmentIds.map((attId) =>
        c.env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(attId),
      );

      const attachmentStatements = newAttachments.map((att) => {
        return c.env.DB.prepare(
          `INSERT INTO attachments (
            id,
            document_id,
            file_name,
            file_size,
            mime_type,
            r2_key,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          att.id,
          id,
          att.fileName,
          att.fileSize,
          att.mimeType,
          att.r2Key,
          updatedAt,
        );
      });

      try {
        await c.env.DB.batch([
          updateDocStatement,
          ...deleteUnusedStatements,
          ...attachmentStatements,
        ]);
      } catch (error) {
        console.error('MCP D1 更新エラー:', error);
        return {
          isError: true,
          content: [
            { type: 'text', text: 'ドキュメント情報の更新に失敗しました。' },
          ],
        };
      }

      const publicUrl = resolvePublicUrl(c.req.url, c.env.FRONTEND_ORIGIN, id);

      return {
        content: [
          {
            type: 'text',
            text: [
              'ドキュメントを正常に更新しました。',
              '',
              `- タイトル: ${nextTitle}`,
              `- 公開URL: ${publicUrl}`,
              `- 更新日時: ${updatedAt}`,
            ].join('\n'),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_document',
    {
      description:
        '指定されたドキュメントの Markdown 本文原本およびメタデータ、添付ファイル一覧を取得します。',
      inputSchema: mcpGetDocumentSchema.shape,
    },
    async (params) => {
      if (!patUser.scopes.includes('documents:read')) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: '操作に必要な権限(スコープ: documents:read)がありません。',
            },
          ],
        };
      }

      const { id, passcode } = params;

      const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?')
        .bind(id)
        .first<AuthenticatedDocument>();

      if (!doc || doc.status === 'deleted') {
        return {
          isError: true,
          content: [{ type: 'text', text: 'ドキュメントが見つかりません。' }],
        };
      }

      if (doc.status === 'suspended') {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'このドキュメントは規約違反または通報により凍結されています。',
            },
          ],
        };
      }

      if (doc.expires_at && new Date(doc.expires_at).getTime() < Date.now()) {
        return {
          isError: true,
          content: [
            { type: 'text', text: 'このドキュメントは有効期限切れです。' },
          ],
        };
      }

      if (doc.visibility === 'protected') {
        const parsedUser = parseUserId(patUser.userId);
        const isOwner =
          parsedUser &&
          doc.owner_user_id === parsedUser.providerUserId &&
          doc.owner_provider === parsedUser.provider;

        if (!isOwner) {
          if (!passcode) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: 'このドキュメントはパスコードで保護されています。パスコードを指定してください。',
                },
              ],
            };
          }

          const isValid = await verifyPasscode(
            passcode,
            doc.passcode_hash || '',
          );
          if (!isValid) {
            return {
              isError: true,
              content: [
                { type: 'text', text: 'パスコードが正しくありません。' },
              ],
            };
          }
        }
      }

      const r2Creds = {
        accountId: c.env.CLOUDFLARE_ACCOUNT_ID,
        accessKeyId: c.env.R2_ACCESS_KEY_ID,
        secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
        bucketName: c.env.R2_BUCKET_NAME,
      };

      const markdownText = await getR2Text(
        c.env.BUCKET,
        doc.content_r2_key,
        r2Creds,
      );

      if (markdownText === null) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'ドキュメントの本文データが見つかりません。',
            },
          ],
        };
      }

      const attachments = await c.env.DB.prepare(
        'SELECT id, file_name, file_size, mime_type, r2_key, created_at FROM attachments WHERE document_id = ?',
      )
        .bind(id)
        .all<{
          id: string;
          file_name: string;
          file_size: number;
          mime_type: string;
          r2_key: string;
          created_at: string;
        }>();

      const attachmentList = (attachments.results || []).map((att) => ({
        fileName: att.file_name,
        fileSize: att.file_size,
        mimeType: att.mime_type,
        assetUrl: `/api/assets/${att.r2_key}`,
      }));

      const publicUrl = resolvePublicUrl(c.req.url, c.env.FRONTEND_ORIGIN, id);

      return {
        content: [
          {
            type: 'text',
            text: [
              `# ${doc.title}`,
              '',
              `- ドキュメントID: ${doc.id}`,
              `- 公開URL: ${publicUrl}`,
              `- 公開範囲: ${doc.visibility}`,
              `- 作成日時: ${doc.created_at}`,
              `- 更新日時: ${doc.updated_at}`,
              doc.expires_at
                ? `- 有効期限: ${doc.expires_at}`
                : '- 有効期限: 無期限',
              doc.description ? `- 概要: ${doc.description}` : null,
              attachmentList.length > 0
                ? `- 添付ファイル数: ${attachmentList.length}件`
                : null,
              '',
              '--- 本文開始 ---',
              markdownText,
              '--- 本文終了 ---',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      };
    },
  );

  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });

  await server.connect(transport);

  const reqToHandle = normalizeMcpRequest(c.req.raw);
  return transport.handleRequest(reqToHandle);
});
