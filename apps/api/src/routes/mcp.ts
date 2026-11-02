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
  ALLOWED_IMAGE_MIME_TYPES,
  EXPIRATION_PRESETS,
  MAX_SINGLE_FILE_SIZE,
  MAX_TITLE_LENGTH,
  MAX_TOTAL_FILE_SIZE,
  MIN_TITLE_LENGTH,
  SLUG_PATTERN,
  generateCapabilityToken,
  hashToken,
} from '@patto-md/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { calculateExpiresAt } from '../lib/date.ts';
import {
  decodeBase64Image,
  replaceMarkdownAssetPaths,
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
import { generateSlug } from '../lib/slug.ts';
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

  server.tool(
    'publish_document',
    'Markdownドキュメントおよび添付画像を patto-md へ新規公開し、閲覧用パーマリンクURLを発行します。',
    {
      title: z
        .string()
        .min(MIN_TITLE_LENGTH, 'タイトルの指定が必要です。')
        .max(
          MAX_TITLE_LENGTH,
          `タイトルは最大${MAX_TITLE_LENGTH}文字までです。`,
        )
        .describe('ドキュメントのタイトル(1〜100文字)'),
      content: z
        .string()
        .min(1, '本文の入力が必要です。')
        .describe('Markdown 本文'),
      description: z
        .string()
        .max(500, '要約は最大500文字までです。')
        .optional()
        .describe('ドキュメントの要約・抜粋(任意、最大500文字)'),
      expiration: z
        .enum(EXPIRATION_PRESETS, {
          error: '無効な有効期限の指定です。',
        })
        .default('7days')
        .describe(
          '有効期限プリセット(1day, 7days, 30days, never。既定値: 7days)',
        ),
      visibility: z
        .enum(['public', 'unlisted', 'protected'], {
          error: '無効な公開範囲の指定です。',
        })
        .default('unlisted')
        .describe('公開範囲(public, unlisted, protected。既定値: unlisted)'),
      passcode: z
        .string()
        .min(4, 'パスコードは4文字以上で指定してください。')
        .max(32, 'パスコードは32文字以内で指定してください。')
        .optional()
        .describe(
          'パスコード保護時の暗証番号(visibilityがprotectedの場合に有効、4〜32文字)',
        ),
      images: z
        .array(
          z.object({
            path: z
              .string()
              .min(1)
              .max(255)
              .describe('Markdown 本文内の相対パス(例: `./images/arch.png`)'),
            base64Data: z
              .string()
              .min(1)
              .describe('画像データの Base64 文字列'),
            mimeType: z
              .enum(ALLOWED_IMAGE_MIME_TYPES)
              .describe(
                '画像の MIME タイプ(`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/svg+xml`)',
              ),
          }),
        )
        .max(10, '添付画像は最大10件までです。')
        .optional()
        .describe('添付画像リスト(最大10件、単一最大10MB、合計最大30MB)'),
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

      let totalEstimatedBytes = 0;
      for (const img of images) {
        const estimatedSize = Math.ceil((img.base64Data.length * 3) / 4);
        if (estimatedSize > MAX_SINGLE_FILE_SIZE) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `画像「${img.path}」のサイズが単一上限(${MAX_SINGLE_FILE_SIZE / (1024 * 1024)}MB)を超過しています。`,
              },
            ],
          };
        }
        totalEstimatedBytes += estimatedSize;
      }
      if (totalEstimatedBytes > MAX_TOTAL_FILE_SIZE) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `添付画像の合計サイズが上限(${MAX_TOTAL_FILE_SIZE / (1024 * 1024)}MB)を超過しています。`,
            },
          ],
        };
      }

      const expectedPrefix = getExpirationPrefix(expiration);
      const docUuid = crypto.randomUUID();
      const contentR2Key = `${expectedPrefix}uploads/${docUuid}/content.md`;
      const createdAt = new Date().toISOString();
      const updatedAt = createdAt;
      const expiresAt = calculateExpiresAt(expiration, new Date(createdAt));

      const pathMappings: AssetPathMapping[] = [];
      const attachmentRecords: Array<{
        id: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
        r2Key: string;
      }> = [];

      try {
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

          await c.env.BUCKET.put(r2Key, buffer, {
            httpMetadata: { contentType: img.mimeType },
          });

          pathMappings.push({
            originalPath: img.path,
            r2Key,
          });

          attachmentRecords.push({
            id: fileId,
            fileName,
            fileSize: buffer.byteLength,
            mimeType: img.mimeType,
            r2Key,
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

      const editToken = generateCapabilityToken('edit');
      const modifyToken = generateCapabilityToken('modify');
      const [editTokenHash, modifyTokenHash] = await Promise.all([
        hashToken(editToken),
        hashToken(modifyToken),
      ]);

      let passcodeHash: string | null = null;
      if (visibility === 'protected' && passcode) {
        passcodeHash = await hashPasscode(passcode);
      }

      const parsedUser = parseUserId(patUser.userId);
      const ownerUserId = parsedUser?.providerUserId ?? null;
      const ownerProvider = parsedUser?.provider ?? null;

      const maxRetries = 3;
      let committedSlug: string | null = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const candidateSlug = generateSlug();

        const docStatement = c.env.DB.prepare(
          `INSERT INTO documents (
            id,
            title,
            description,
            content_r2_key,
            status,
            expires_at,
            edit_token_hash,
            modify_token_hash,
            visibility,
            passcode_hash,
            owner_user_id,
            owner_provider,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          candidateSlug,
          title,
          description ?? null,
          contentR2Key,
          expiresAt,
          editTokenHash,
          modifyTokenHash,
          visibility,
          passcodeHash,
          ownerUserId,
          ownerProvider,
          createdAt,
          updatedAt,
        );

        const attachmentStatements = attachmentRecords.map((att) => {
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
            candidateSlug,
            att.fileName,
            att.fileSize,
            att.mimeType,
            att.r2Key,
            createdAt,
          );
        });

        try {
          await c.env.DB.batch([docStatement, ...attachmentStatements]);
          committedSlug = candidateSlug;
          break;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          if (
            errorMessage.includes('UNIQUE constraint failed') ||
            errorMessage.includes('PRIMARY KEY')
          ) {
            console.warn(
              `MCP Slug衝突を検知(${candidateSlug})。再試行中(${attempt + 1}/${maxRetries})...`,
            );
            continue;
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
      }

      if (!committedSlug) {
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

      const baseUrl =
        c.env.FRONTEND_ORIGIN ||
        new URL(c.req.url).origin.replace(/\/api\/mcp|\/mcp$/, '');
      const publicUrl = `${baseUrl}/p/${committedSlug}`;

      return {
        content: [
          {
            type: 'text',
            text: [
              'ドキュメントを正常に公開しました。',
              '',
              `- タイトル: ${title}`,
              `- 公開URL: ${publicUrl}`,
              `- ドキュメントID: ${committedSlug}`,
              `- 公開範囲: ${visibility}`,
              `- 有効期限: ${expiresAt ?? '無期限'}`,
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

  server.tool(
    'update_document',
    '既存のドキュメントの Markdown 本文やタイトル、メタデータを更新します。自身の PAT で作成したドキュメントのみ更新可能です。',
    {
      id: z
        .string()
        .regex(SLUG_PATTERN, '無効なドキュメントID形式です。')
        .describe('更新対象ドキュメントのID(Slug 12文字)'),
      content: z
        .string()
        .min(1, '本文の入力が必要です。')
        .describe('更新後の Markdown 本文'),
      title: z
        .string()
        .min(MIN_TITLE_LENGTH, 'タイトルの指定が必要です。')
        .max(
          MAX_TITLE_LENGTH,
          `タイトルは最大${MAX_TITLE_LENGTH}文字までです。`,
        )
        .optional()
        .describe('更新後のタイトル(任意。未指定時は既存維持)'),
      description: z
        .string()
        .max(500, '要約は最大500文字までです。')
        .optional()
        .describe('更新後の要約・抜粋(任意)'),
      visibility: z
        .enum(['public', 'unlisted', 'protected'], {
          error: '無効な公開範囲の指定です。',
        })
        .optional()
        .describe('更新後の公開範囲(任意)'),
      passcode: z
        .string()
        .min(4, 'パスコードは4文字以上で指定してください。')
        .max(32, 'パスコードは32文字以内で指定してください。')
        .optional()
        .describe('更新後のパスコード(任意)'),
      images: z
        .array(
          z.object({
            path: z.string().min(1).max(255),
            base64Data: z.string().min(1),
            mimeType: z.enum(ALLOWED_IMAGE_MIME_TYPES),
          }),
        )
        .max(10, '添付画像は最大10件までです。')
        .optional()
        .describe('新規追加する添付画像リスト(任意)'),
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
        try {
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

            await c.env.BUCKET.put(r2Key, buffer, {
              httpMetadata: { contentType: img.mimeType },
            });

            pathMappings.push({ originalPath: img.path, r2Key });
            newAttachments.push({
              id: fileId,
              fileName,
              fileSize: buffer.byteLength,
              mimeType: img.mimeType,
              r2Key,
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
        await c.env.DB.batch([updateDocStatement, ...attachmentStatements]);
      } catch (error) {
        console.error('MCP D1 更新エラー:', error);
        return {
          isError: true,
          content: [
            { type: 'text', text: 'ドキュメント情報の更新に失敗しました。' },
          ],
        };
      }

      const baseUrl =
        c.env.FRONTEND_ORIGIN ||
        new URL(c.req.url).origin.replace(/\/api\/mcp|\/mcp$/, '');
      const publicUrl = `${baseUrl}/p/${id}`;

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

  server.tool(
    'get_document',
    '指定されたドキュメントの Markdown 本文原本およびメタデータ、添付ファイル一覧を取得します。',
    {
      id: z
        .string()
        .regex(SLUG_PATTERN, '無効なドキュメントID形式です。')
        .describe('取得対象ドキュメントのID(Slug 12文字)'),
      passcode: z
        .string()
        .optional()
        .describe('パスコード保護ドキュメント閲覧時の暗証番号(任意)'),
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

      const baseUrl =
        c.env.FRONTEND_ORIGIN ||
        new URL(c.req.url).origin.replace(/\/api\/mcp|\/mcp$/, '');
      const publicUrl = `${baseUrl}/p/${id}`;

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
