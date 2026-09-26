import type { ApiResponse } from '@caro/ui/api/client';

/** Extracts the filename from an `attachment; filename="..."` header, or null. */
export function parseAttachmentFileName(contentDisposition: string | null): string | null {
  const match = contentDisposition?.match(/filename="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Downloads the Tag Defs ZIP for rootName (GET /api/v1/tag-defs).
 * Bypasses apiClient because the success body is binary, not the JSON
 * envelope; error responses are still the envelope and are thrown as Error.
 */
export async function downloadTagDefs(rootName: string): Promise<void> {
  const res = await fetch(`/api/v1/tag-defs?root=${encodeURIComponent(rootName)}`, { cache: 'no-store' });

  if (!res.ok) {
    const json = (await res.json()) as ApiResponse<never>;
    throw new Error(json.ok ? 'Failed to generate Tag Defs' : json.error.message);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = parseAttachmentFileName(res.headers.get('content-disposition')) ?? 'TagDefs.zip';
  a.click();
  URL.revokeObjectURL(url);
}
