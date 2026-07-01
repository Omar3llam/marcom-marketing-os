import { Router } from 'express';
import { mountFeedRoutes }    from './feed.js';
import { mountContextRoutes } from './context.js';

export const campaignsRouter = Router();

mountFeedRoutes(campaignsRouter);
mountContextRoutes(campaignsRouter);
