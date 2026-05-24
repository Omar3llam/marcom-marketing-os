import { Router } from 'express';
import { mountFeedRoutes }    from './feed.js';
import { mountUploadRoutes }  from './upload.js';
import { mountContextRoutes } from './context.js';

export const campaignsRouter = Router();

mountFeedRoutes(campaignsRouter);
mountUploadRoutes(campaignsRouter);
mountContextRoutes(campaignsRouter);
