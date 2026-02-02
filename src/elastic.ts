import { Client } from '@elastic/elasticsearch';
import { components } from './types.g';

type ShareUrl = components['schemas']['ShareUrl'];
type MapLayerData = components['schemas']['MapLayerData'];

const ES_URL = process.env.ES_URL || 'http://localhost:9200';

const INDICES = {
    USER_LAYERS: 'custom_user_layers',
    SHARE_URLS: 'shares',
};

const client = new Client({
    node: ES_URL,
});

export const initialize = async () => {
    console.log(`Initializing Elasticsearch at ${ES_URL}`);

    const sharesExists = await client.indices.exists({ index: INDICES.SHARE_URLS });
    if (!sharesExists) {
        console.log(`Creating index: ${INDICES.SHARE_URLS}`);
        await client.indices.create({ index: INDICES.SHARE_URLS });
    }

    const layersExists = await client.indices.exists({ index: INDICES.USER_LAYERS });
    if (!layersExists) {
        console.log(`Creating index: ${INDICES.USER_LAYERS}`);
        await client.indices.create({ index: INDICES.USER_LAYERS });
    }
};

// --- ShareUrl Methods ---

export const addUrl = async (shareUrl: ShareUrl): Promise<void> => {
    await client.index({
        index: INDICES.SHARE_URLS,
        id: shareUrl.id!,
        document: shareUrl,
        refresh: true
    });
};

export const getUrlById = async (id: string): Promise<ShareUrl | null> => {
    try {
        const result = await client.get<ShareUrl>({
            index: INDICES.SHARE_URLS,
            id: id
        });
        return result._source || null;
    } catch (e: any) {
        if (e.meta && e.meta.statusCode === 404) return null;
        throw e;
    }
};

export const getUrlTimestampById = async (id: string): Promise<string | null> => {
    try {
        const result = await client.get<ShareUrl>({
            index: INDICES.SHARE_URLS,
            id: id,
            _source_includes: ['lastModifiedDate', 'creationDate']
        });
        const source = result._source;
        if (!source) return null;

        // Logic mimicking FixModifiedDate: if modified < created, use created
        let modified = source.lastModifiedDate;
        const created = source.creationDate;

        if (modified && created && new Date(modified) < new Date(created)) {
            modified = created;
        }

        return modified || null;
    } catch (e: any) {
        if (e.meta && e.meta.statusCode === 404) return null;
        throw e;
    }
};

export const getUrlsByUser = async (osmUserId: string): Promise<ShareUrl[]> => {
    const result = await client.search<ShareUrl>({
        index: INDICES.SHARE_URLS,
        size: 5000,
        query: {
            term: {
                "osmUserId.keyword": osmUserId
            }
        },
        _source: {
            excludes: ['dataContainer', 'base64Preview']
        }
    });
    return result.hits.hits.map(h => h._source!);
};

export const deleteUrl = async (id: string): Promise<void> => {
    await client.delete({
        index: INDICES.SHARE_URLS,
        id: id,
        refresh: true
    });
};

export const updateUrl = async (shareUrl: ShareUrl): Promise<void> => {
    await addUrl(shareUrl);
};

export const updateUrlStats = async (id: string, viewsCount: number, lastViewed: string): Promise<void> => {
    await client.update({
        index: INDICES.SHARE_URLS,
        id: id,
        doc: {
            lastViewed: lastViewed,
            viewsCount: viewsCount
        }
    });
};

// --- UserLayers Methods ---

export const getUserLayers = async (osmUserId: string): Promise<MapLayerData[]> => {
    const result = await client.search<MapLayerData>({
        index: INDICES.USER_LAYERS,
        size: 1000,
        query: {
            term: {
                "osmUserId.keyword": osmUserId
            }
        }
    });

    return result.hits.hits.map(h => {
        const doc = h._source!;
        doc.id = h._id;
        return doc;
    });
};

export const getUserLayerById = async (id: string): Promise<MapLayerData | null> => {
    try {
        const result = await client.get<MapLayerData>({
            index: INDICES.USER_LAYERS,
            id: id
        });
        const source = result._source!;
        source.id = id;
        return source;
    } catch (e: any) {
        if (e.meta && e.meta.statusCode === 404) return null;
        throw e;
    }
};

export const addUserLayer = async (layer: MapLayerData): Promise<MapLayerData> => {
    const response = await client.index({
        index: INDICES.USER_LAYERS,
        id: layer.id || undefined,
        document: layer,
        refresh: true
    });
    layer.id = response._id;
    return layer;
};

export const updateUserLayer = async (layer: MapLayerData): Promise<void> => {
    await client.index({
        index: INDICES.USER_LAYERS,
        id: layer.id!,
        document: layer,
        refresh: true
    });
};

export const deleteUserLayer = async (id: string): Promise<void> => {
    await client.delete({
        index: INDICES.USER_LAYERS,
        id: id,
        refresh: true
    });
};
