// Public: what the Flutter app needs to match this server. Only NEXT_PUBLIC_* values, which are public by design
// (Next.js inlines them into every web page); never a secret from the env.
// clerkPublishableKey: sign in to the same Clerk instance this server checks tokens against.
// vapi: the voice assistant (null hides the mic, as on the web).
export const GET = () => {
  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
  const assistantId = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;
  return Response.json({
    clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null,
    vapi: publicKey && assistantId ? { publicKey, assistantId } : null,
  });
};
