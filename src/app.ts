import express, { Request, Response, NextFunction } from 'express';
import { middleware } from 'express-openapi-validator';
import swaggerUi from 'swagger-ui-express';
import cors from 'cors';

import * as elasticGateway from './elastic.js';
import { components } from './types.g.js';
import { authenticate } from './auth.js';
import { uploadImageAndUpdateLink } from './imgur.js';
import { isPartner } from './partners.js';
import apiDocs from './user-data.openapi.json';

export const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(apiDocs));

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.use(
    middleware({
        apiSpec: apiDocs as any,
        validateRequests: {
            removeAdditional: 'all'
        },
        validateResponses: true,
    }),
);

/**
 * Fixes the routing type for all segments in a share URL.
 * It's not clear how these were created, but they need a fix nevertheless...
 * @param shareUrl The share URL to fix.
 */
function fixRoutingType(shareUrl: ShareUrl) {
    for (const route of shareUrl.dataContainer?.routes || []) {
        for (const segment of route.segments || []) {
            if (segment.routingType !== "Hike" &&
                segment.routingType !== "Bike" &&
                segment.routingType !== "4WD" &&
                segment.routingType !== "None") {
                segment.routingType = "Hike";
            }
        }
    }
}

// Apply auth middleware to all routes starting with /api
// Spec says security is applied, so we can apply globally after validator (which checks schema) but before handlers.
app.use('/api', authenticate);

type ShareUrl = components['schemas']['ShareUrl'];
type MapLayerData = components['schemas']['MapLayerData'];

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
        res.status(200).send('');
    } catch (error) {
        next(error);
    }
});

app.delete('/api/UserLayers/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user?.osmUserId) return res.status(401).json({ message: 'Unauthorized' });
        const id = req.params.id as string;
        await elasticGateway.deleteUserLayer(id);
        res.status(200).send('');
    } catch (error) {
        next(error);
    }
});

// --- Urls (ShareUrl) ---

function getRandomString(length: number) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

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

app.get('/api/urls/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const shareUrl = await elasticGateway.getUrlById(id);
        if (!shareUrl) return res.sendStatus(404);

        fixRoutingType(shareUrl);

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

        if (!shareUrl) {
            res.status(404).json({ message: 'Share URL not found' });
            return;
        }

        if (shareUrl.base64Preview) {
            const img = Buffer.from(shareUrl.base64Preview.split(',')[1], 'base64');
            res.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': img.length
            });
            res.end(img);
        } else {
            res.status(404).json({ message: 'Image not found' });
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

        fixRoutingType(shareUrl);

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

        if (incoming.gain) {
            existing.gain = incoming.gain;
        }
        if (incoming.loss) {
            existing.loss = incoming.loss;
        }
        if (incoming.length) {
            existing.length = incoming.length;
        }
        if (incoming.website) {
            existing.website = incoming.website;
        }
        if (incoming.difficulty) {
            existing.difficulty = incoming.difficulty;
        }
        if (incoming.type) {
            existing.type = incoming.type;
        }
        if (typeof incoming.circular === 'boolean') {
            existing.circular = incoming.circular;
        }
        if (typeof incoming.public === 'boolean') {
            existing.public = incoming.public && isPartner(req.user.osmUserId);
        }
        if (incoming.dataContainer) {
            existing.dataContainer = incoming.dataContainer;
        }
        if (incoming.base64Preview && incoming.base64Preview.startsWith('data:image')) {
            existing.base64Preview = incoming.base64Preview;
        }
        if (incoming.start) {
            existing.start = incoming.start;
        }

        fixRoutingType(existing);

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
        res.status(200).send('');
    } catch (error) {
        next(error);
    }
});


// --- User Permissions ---

app.get('/api/User/permissions', async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user?.osmUserId) return res.status(401).json({ message: 'Unauthorized' });
        res.json({
            canPublishPublic: isPartner(req.user.osmUserId)
        });
    } catch (error) {
        next(error);
    }
});

// --- Public Routes ---

app.get('/api/PublicRoutes', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const urls = await elasticGateway.getPublicUrls();
        const features = urls.map(url => {
            let poiIcon = "icon-question";
            let poiCategory = "Other";
            if (url.type === "Hiking") {
                poiIcon = "icon-hike";
                poiCategory = "Hiking";
            } else if (url.type === "Biking") {
                poiIcon = "icon-bike";
                poiCategory = "Bicycle";
            } else if (url.type === "4x4") {
                poiIcon = "icon-four-by-four";
                poiCategory = "4x4";
            }

            return {
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [url.start?.lng, url.start?.lat]
                },
                properties: {
                    poiCategory: poiCategory,
                    poiSource: "Users",
                    poiIcon: poiIcon,
                    poiIconColor: "black",
                    poiLength: url.length,
                    poiDifficulty: url.difficulty,
                    poiId: "Users_" + url.id,
                    poiUserId: url.osmUserId,
                    identifier: url.id,
                    name: url.title,
                    description: url.description,
                    website: url.website,
                    image: "https://mapeak.com/api/urls/" + url.id + "/thumbnail"
                }
            }
        })
        const json = JSON.stringify({
            type: "FeatureCollection",
            features: features
        });
        res.attachment("public-routes.geojson");
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(json)
        });
        res.end(json);
    } catch (error) {
        next(error);
    }
});

// --- Error Handling ---

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    res.status(err.status || 500).json({
        message: err.message,
        errors: err.errors,
    });
    console.log(req.url + " : " + err.message);
});
