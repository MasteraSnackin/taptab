type LivenessOptions = Readonly<{
  now?: () => number;
  requestId?: string;
}>;

export function createLivenessResponse({
  now = Date.now,
  requestId = crypto.randomUUID(),
}: LivenessOptions = {}) {
  const checkedAt = new Date(now()).toISOString();

  return Response.json(
    {
      status: "ok",
      service: "taptab",
      checkedAt,
      requestId,
    },
    {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
    },
  );
}

export function GET() {
  return createLivenessResponse();
}
