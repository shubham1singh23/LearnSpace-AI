import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, rename, readFile, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import sharp, { type OutputInfo } from 'sharp';
import { z } from 'zod';
import { assetSchema, idSchema } from '@learnspace/shared';
import type { Database } from '../db.js';
import { HttpError } from '../errors.js';
import { lockCourse, transaction } from './transactions.js';

function contained(root: string, key: string) {
  if (!/^[a-f0-9-]+\.(png|jpeg|webp)$/.test(key)) throw new HttpError(409, 'ASSET_UNAVAILABLE', 'Asset storage record is invalid.');
  const path = resolve(root, key);
  if (!path.startsWith(resolve(root) + sep)) throw new HttpError(409, 'ASSET_UNAVAILABLE', 'Asset is unavailable.');
  return path;
}
export function assetRouter(db: Database, root: string) {
  const router = Router();
  const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, fieldSize: 4000, parts: 2 } }).single('file');
  router.post('/courses/:id/assets', (req, res, next) => {
    multipart(req, res, error => {
      if (error) return next(new HttpError(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 422, 'INVALID_UPLOAD', 'Upload one PNG, JPEG or WebP image up to 10 MiB.'));
      next();
    });
  }, async (req, res) => {
    const courseId = idSchema.parse(req.params.id);
    const input = z.object({ alt: z.string().max(1000).optional() }).strict().parse(req.body);
    if (!req.file) throw new HttpError(422, 'INVALID_UPLOAD', 'Select an image.');
    const mime = req.file.mimetype;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only raster PNG, JPEG and WebP are supported.');
    let output: { data: Buffer; info: OutputInfo };
    let format: 'png' | 'jpeg' | 'webp';
    try {
      const decoder = sharp(req.file.buffer, { limitInputPixels: 25000000, failOn: 'warning' });
      const metadata = await decoder.metadata();
      if ((metadata.format !== 'png' && metadata.format !== 'jpeg' && metadata.format !== 'webp') || (metadata.pages ?? 1) > 1 || `image/${metadata.format}` !== mime) throw new Error('Unsupported raster');
      format = metadata.format;
      output = await decoder.rotate().toFormat(format).toBuffer({ resolveWithObject: true });
    } catch { throw new HttpError(422, 'INVALID_IMAGE', 'Image could not be decoded within the raster limits.'); }
    if (output.data.length > 10 * 1024 * 1024) throw new HttpError(413, 'IMAGE_TOO_LARGE', 'Decoded image exceeds 10 MiB.');
    const id = randomUUID(); const key = `${id}.${format}`; const path = contained(root, key); const staged = `${path}.tmp`;
    await mkdir(root, { recursive: true });
    // Write complete immutable bytes before committing a ready database record.
    await writeFile(staged, output.data, { flag: 'wx', mode: 0o600 });
    await rename(staged, path);
    // An ambiguous DB failure may leave an orphan file. Retain it rather than
    // risk removing bytes belonging to a committed ready record (GC is deferred).
      const asset = await transaction(db, async tx => {
        await lockCourse(tx, courseId);
        return tx.asset.create({ data: { id, courseId, storageKey: key, originalName: req.file!.originalname.replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 240) || 'image', mimeType: mime, bytes: output.data.length, width: output.info.width, height: output.info.height, sha256: createHash('sha256').update(output.data).digest('hex'), source: 'upload', state: 'ready' } });
      });
      res.status(201).json({ data: assetSchema.parse({ id, mimeType: asset.mimeType, bytes: asset.bytes, width: asset.width, height: asset.height, url: `/api/v1/assets/${id}/content`, ...input }), requestId: res.locals.requestId });
  });
  router.get('/assets/:id/content', async (req, res) => {
    const asset = await db.asset.findUnique({ where: { id: idSchema.parse(req.params.id) } });
    if (!asset || asset.state !== 'ready' || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType)) throw new HttpError(404, 'ASSET_UNAVAILABLE', 'Image unavailable.');
    let data: Buffer;
    try { data = await readFile(contained(root, asset.storageKey)); }
    catch { throw new HttpError(404, 'ASSET_UNAVAILABLE', 'Image file unavailable.'); }
    if (createHash('sha256').update(data).digest('hex') !== asset.sha256) throw new HttpError(409, 'ASSET_UNAVAILABLE', 'Image integrity check failed.');
    res.set({ 'Content-Type': asset.mimeType, 'Content-Length': String(data.length), 'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=31536000, immutable' }).send(data);
  });
  router.delete('/assets/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const asset = await transaction(db, async tx => {
      const current = await tx.asset.findUnique({ where: { id } });
      if (!current) throw new HttpError(404, 'NOT_FOUND', 'Asset not found.');
      await lockCourse(tx, current.courseId);
      if (await tx.lessonAsset.count({ where: { assetId: id } }) || await tx.versionAsset.count({ where: { assetId: id } }) || await tx.exportAsset.count({ where: { assetId: id } })) throw new HttpError(409, 'ASSET_IN_USE', 'Image is retained by saved notes or history.');
      await tx.asset.delete({ where: { id } }); return current;
    });
    await unlink(contained(root, asset.storageKey)).catch(() => undefined);
    res.status(204).end();
  });
  return router;
}
