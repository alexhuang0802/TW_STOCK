import { NextResponse } from 'next/server';

const OWNER = 'alexhuang0802';
const REPO = 'TW_STOCK';
const WORKFLOW_FILE = 'daily_scan.yml';

export async function POST() {
  const token = process.env.SCAN_TRIGGER_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: '伺服器尚未設定 SCAN_TRIGGER_TOKEN，無法觸發掃描。' },
      { status: 500 }
    );
  }

  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `觸發失敗（${res.status}）：${text}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
