import { NextResponse } from 'next/server';
import { lookupTitles } from '../_lib/catalog';

/** GET /api/catalog?codes=CSE 29,CSE 105 → { "CSE 29": { title, units } } */
export function GET(req: Request) {
  const codes = (new URL(req.url).searchParams.get('codes') ?? '').split(',').filter(Boolean).slice(0, 80);
  return NextResponse.json(lookupTitles(codes));
}
