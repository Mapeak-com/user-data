import express, { Request, Response, NextFunction } from 'express';
import { middleware } from 'express-openapi-validator';
import swaggerUi from 'swagger-ui-express';
import * as elasticGateway from './elastic.js';
import { components } from './types.g.js';
import { authenticate } from './auth.js';
import apiDocs from './user-data.openapi.json';

import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(apiDocs));

app.use(
    middleware({
        apiSpec: apiDocs as any,
        validateRequests: {
            removeAdditional: 'all'
        },
        validateResponses: true,
    }),
);

// Apply auth middleware to all routes starting with /api
// Spec says security is applied, so we can apply globally after validator (which checks schema) but before handlers.
app.use('/api', authenticate);

type ShareUrl = components['schemas']['ShareUrl'];
type MapLayerData = components['schemas']['MapLayerData'];
type LinkData = components["schemas"]["LinkData"];

// --- UserLayers ---

app.get('/api/UserLayers', async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user?.osmUserId) return res.status(401).json({ message: 'Unauthorized' });
        const layers = await elasticGateway.getUserLayers(req.user.osmUserId);
        res.json(layers);
    } catch (error) {
        next(error);
    }
});

app.post('/api/UserLayers', async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user?.osmUserId) return res.status(401).json({ message: 'Unauthorized' });
        const layer = req.body as MapLayerData;

        if (!layer.id) {
            layer.id = crypto.randomUUID();
        }

        // Set user ID from token
        layer.osmUserId = req.user.osmUserId;

        const created = await elasticGateway.addUserLayer(layer);
        res.json(created);
    } catch (error) {
        next(error);
    }
});

app.put('/api/UserLayers/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user?.osmUserId) return res.status(401).json({ message: 'Unauthorized' });
        const id = req.params.id as string;
        const layer = req.body as MapLayerData;
        layer.id = id;
        layer.osmUserId = req.user.osmUserId;

        await elasticGateway.updateUserLayer(layer);
        res.sendStatus(200);
    } catch (error) {
        next(error);
    }
});

app.delete('/api/UserLayers/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user?.osmUserId) return res.status(401).json({ message: 'Unauthorized' });
        const id = req.params.id as string;
        await elasticGateway.deleteUserLayer(id);
        res.sendStatus(200);
    } catch (error) {
        next(error);
    }
});

// --- Urls (ShareUrl) ---

const getRandomString = (length: number) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

function fixModifiedDate(shareUrl: ShareUrl) {
    if (shareUrl.lastModifiedDate! < shareUrl.creationDate!) {
        shareUrl.lastModifiedDate = shareUrl.creationDate;
    }
}

const uploadImagesIfNeeded = async (shareUrl: ShareUrl) => {
    const uploadPromises = [];

    for (const route of shareUrl.dataContainer?.routes || []) {
        for (const marker of route?.markers || []) {
            for (let url of marker?.urls || []) {
                if (url?.url?.startsWith('data:image')) {
                    uploadPromises.push(uploadImageAndUpdateLink(url));
                }
            }
        }
    }

    Promise.all(uploadPromises).then(() => {
        elasticGateway.updateUrl(shareUrl);
    });
};

const uploadImageAndUpdateLink = async (url: LinkData) => {
    var myHeaders = new Headers();
    myHeaders.append("Authorization", "Client-ID " + process.env.IMGUR_CLIENT_ID);

    var formdata = new FormData();
    const res = await fetch(url.url!);
    const imageBlob = await res.blob();
    formdata.append("image", imageBlob);

    var requestOptions = {
        method: 'POST',
        headers: myHeaders,
        body: formdata,
    };

    const response = await fetch("https://api.imgur.com/3/image", requestOptions);
    const result = await response.json();
    url.url = result.data.link;
};

app.get('/api/urls/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const shareUrl = await elasticGateway.getUrlById(id);
        if (!shareUrl) return res.sendStatus(404);

        const now = new Date().toISOString();
        shareUrl.lastViewed = now;
        shareUrl.viewsCount = (shareUrl.viewsCount || 0) + 1;

        // Partial update for stats
        await elasticGateway.updateUrlStats(id, shareUrl.viewsCount, now);

        res.json(shareUrl);
    } catch (error) {
        next(error);
    }
});

app.get('/api/urls/:id/timestamp', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const timestamp = await elasticGateway.getUrlTimestampById(id);
        if (!timestamp) return res.sendStatus(404);
        res.json(timestamp);
    } catch (error) {
        next(error);
    }
});

app.get('/api/urls/:id/thumbnail', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const shareUrl = await elasticGateway.getUrlById(id);

        if (!shareUrl) return res.sendStatus(404);

        if (shareUrl.base64Preview) {
            const img = Buffer.from(shareUrl.base64Preview.split(',')[1], 'base64');
            res.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': img.length
            });
            res.end(img);
        } else {
            res.status(501).json({ message: 'Image generation not implemented' });
        }
    } catch (error) {
        next(error);
    }
});

app.get('/api/urls', async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user || !req.user.osmUserId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const hits = await elasticGateway.getUrlsByUser(req.user.osmUserId);

        // Sort in memory
        hits.sort((a, b) => {
            const dateA = new Date(a.lastModifiedDate || 0).getTime();
            const dateB = new Date(b.lastModifiedDate || 0).getTime();
            return dateB - dateA;
        });

        res.json(hits);
    } catch (error) {
        next(error);
    }
});

app.post('/api/urls', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const shareUrl = req.body as ShareUrl;
        if (!shareUrl) return res.status(400).send("Share object in body is required");

        const currentUserId = req.user?.osmUserId;
        if (shareUrl.osmUserId && shareUrl.osmUserId !== currentUserId) {
            return res.status(400).send(`You can't create a share as someone else! ${shareUrl.osmUserId} != ${currentUserId}`);
        }

        const now = new Date().toISOString();
        shareUrl.creationDate = now;
        shareUrl.lastModifiedDate = now;
        shareUrl.lastViewed = now;
        shareUrl.viewsCount = 0;

        let id = getRandomString(10);
        let exists = true;

        // Check existence loop
        while (exists) {
            const existing = await elasticGateway.getUrlById(id);
            if (!existing) {
                exists = false;
            } else {
                id = getRandomString(10);
            }
        }
        shareUrl.id = id;

        await elasticGateway.addUrl(shareUrl);

        uploadImagesIfNeeded(shareUrl);
        res.json(shareUrl);
    } catch (error) {
        next(error);
    }
});

app.put('/api/urls/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const incoming = req.body as ShareUrl;

        if (!req.user || !req.user.osmUserId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const existing = await elasticGateway.getUrlById(id);
        if (!existing) return res.sendStatus(404);

        if (existing.osmUserId !== req.user.osmUserId) {
            return res.status(400).send("You can't update someone else's share!");
        }

        existing.title = incoming.title;
        existing.description = incoming.description;
        existing.lastModifiedDate = new Date().toISOString();

        if (incoming.dataContainer) {
            existing.dataContainer = incoming.dataContainer;
        }
        if (incoming.base64Preview && incoming.base64Preview !== '') {
            existing.base64Preview = incoming.base64Preview;
        }

        await elasticGateway.updateUrl(existing);
        res.json(existing);
    } catch (error) {
        next(error);
    }
});

app.delete('/api/urls/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        if (!req.user || !req.user.osmUserId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const existing = await elasticGateway.getUrlById(id);
        if (!existing) return res.sendStatus(404);

        if (existing.osmUserId !== req.user.osmUserId) {
            return res.status(400).send("You can't delete someone else's share!");
        }

        await elasticGateway.deleteUrl(id);
        res.sendStatus(200);
    } catch (error) {
        next(error);
    }
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    res.status(err.status || 500).json({
        message: err.message,
        errors: err.errors,
    });
    console.log(req.url + " : " + err.message);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server starting on port ${PORT}`);
    await elasticGateway.initialize();
    console.log(`Server started on port ${PORT}`);
});

process.on('SIGINT', function () {
    console.log("Gracefully shutting down from SIGINT (Ctrl-C)");
    process.exit();
});