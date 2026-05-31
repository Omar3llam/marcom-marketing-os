import multer from 'multer';
import { prisma }      from '../../lib/prisma.js';
import { logger }      from '../../utils/logger.js';
import { randomUUID }  from 'crypto';
import { requireAuth } from '../../middleware/firebaseAuth.js';
import path from 'path';
import fs   from 'fs';
import { processAnalyzeUpload, processDbWriteUpload } from '../../services/campaignUploadService.js';

// Accept any file type — AI will extract campaign data from unstructured formats
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = `${Date.now()}-${randomUUID().slice(0, 8)}${path.extname(file.originalname)}`;
      cb(null, uniqueName);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
});

export function mountUploadRoutes(router) {
  router.post('/upload-csv', requireAuth, upload.single('campaignData'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded — expected field "campaignData"' });

    const mode = req.query.mode;

    // Resolve workspaceId with a fallback DB lookup.
    // firebaseAuthMiddleware sets req.workspaceId but its Prisma query can fail
    // transiently (cold start, connection pool exhaustion), leaving it null even
    // for a fully authenticated user. A missing workspace is NOT an auth failure.
    let workspaceId = req.workspaceId;
    if (!workspaceId && req.userId) {
      try {
        const u = await prisma.user.findUnique({
          where:  { clerkId: req.userId },
          select: { workspaceId: true },
        });
        workspaceId = u?.workspaceId ?? null;
      } catch (fallbackErr) {
        logger.error({ err: fallbackErr.message, userId: req.userId }, '[campaigns/upload] workspaceId fallback lookup failed');
      }
    }
    if (!workspaceId) {
      return res.status(403).json({
        error:  'Workspace not found — complete onboarding before uploading.',
        code:   'WORKSPACE_NOT_FOUND',
        hint:   'Visit the onboarding page to create your workspace, then upload again.',
        userId: req.userId || null,
      });
    }

    try {
      const result = mode === 'analyze'
        ? await processAnalyzeUpload(req.file, workspaceId, req.userId)
        : await processDbWriteUpload(req.file, workspaceId, req.userId);
      return res.status(result.statusCode).json(result.body);
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json(err.body);
      logger.error({ err: err.message }, '[campaigns/upload] unexpected error');
      return res.status(500).json({ success: false, error: err.message });
    }
  });
}
