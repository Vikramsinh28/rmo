import { NextRequest } from 'next/server';

export function listQuery(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return {
    search: params.get('search') || undefined,
    status: params.get('status') || undefined,
    zoneId: params.get('zoneId') ? Number(params.get('zoneId')) : undefined,
    divisionId: params.get('divisionId') ? Number(params.get('divisionId')) : undefined,
    role: params.get('role') || undefined,
    page: params.get('page') ? Number(params.get('page')) : undefined,
    pageSize: params.get('pageSize') ? Number(params.get('pageSize')) : undefined,
  };
}
