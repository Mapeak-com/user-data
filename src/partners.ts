import * as path from 'path';
import * as fs from 'fs';

export function isPartner(osmUserId: string): boolean {
    const partnersPath = path.join(process.cwd(), 'partners.json');
    if (!fs.existsSync(partnersPath)) {
        console.log('partners.json not found at ' + partnersPath);
        return false;
    }
    const partnersData = fs.readFileSync(partnersPath, 'utf-8');
    const partners = JSON.parse(partnersData) as string[];
    return partners.includes(String(osmUserId));
}