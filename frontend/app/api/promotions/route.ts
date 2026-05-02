import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const dataDir = path.join(process.cwd(), '..', 'data');

  try {
    const files = fs.readdirSync(dataDir).filter(f =>
      f.endsWith('.json') && !f.startsWith('debug')
    );
    const stores = files
      .map(file => {
        const content = fs.readFileSync(path.join(dataDir, file), 'utf-8');
        return JSON.parse(content);
      })
      .filter(data => data.store && data.store_id && Array.isArray(data.promotions));

    return NextResponse.json({ stores });
  } catch (error) {
    return NextResponse.json(
      { error: '無法讀取優惠資料', stores: [] },
      { status: 500 }
    );
  }
}
