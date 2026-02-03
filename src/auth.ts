import { Request, Response, NextFunction } from 'express';
import { LRUCache } from 'lru-cache';

const cache = new LRUCache<string, string>({
    max: 5000,
    ttl: 12 * 1000 * 60 * 60,
});

// Extend Express Request to include user
declare global {
    namespace Express {
        interface Request {
            user?: {
                osmUserId: string;
                [key: string]: any;
            };
        }
    }
}

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        // Optional auth: if no token, just proceed. req.user will be undefined.
        return next();
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'Invalid token format' });
    }

    const cachedUserId = cache.get(token);
    if (cachedUserId) {
        req.user = { osmUserId: cachedUserId };
        return next();
    }

    try {
        const response = await fetch('https://api.openstreetmap.org/api/0.6/user/details.json', {
            headers: {
                Authorization: authHeader, // forward the Bearer token
                Accept: 'application/json', // Suggest JSON
            }
        });

        if (response.status === 401 || response.status === 403) {
            return res.status(401).json({ message: 'Invalid OSM token' });
        }

        if (!response.ok) {
            console.error(`OSM API returned ${response.status} ${response.statusText}`);
            return res.status(500).json({ message: 'Authentication service unavailable' });
        }

        const text = await response.text();
        let osmUserId: string | undefined;

        const data = JSON.parse(text);
        if (data && data.user && data.user.id) {
            osmUserId = String(data.user.id);
        }
        if (!osmUserId) {
            console.error('Failed to parse OSM user ID from response');
            return res.status(401).json({ message: 'Failed to authenticate with OSM' });
        }
        cache.set(token, osmUserId);

        req.user = { osmUserId };
        next();

    } catch (error) {
        console.error('OSM Auth Error:', error);
        return res.status(500).json({ message: 'Authentication service unavailable' });
    }
};
