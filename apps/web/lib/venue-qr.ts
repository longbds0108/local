// A venue's fixed QR (printed at the counter). The traveller scans it to pay the
// stop booked at that venue; their device then submits the stop's check-in code.
// It carries only the venue id — no secret — so it is safe to print.

export function venuePayload(merchantId: string): string {
  return `hedgora://venue?m=${encodeURIComponent(merchantId)}`;
}

export function parseVenue(text: string): string | null {
  const m = text.trim().match(/^hedgora:\/\/venue\?(.+)$/);
  if (!m) return null;
  const id = new URLSearchParams(m[1]).get("m");
  return id && /^[a-z0-9_-]{1,64}$/i.test(id) ? id : null;
}
