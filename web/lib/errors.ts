// An error with an HTTP status, which `handle()` (server.ts) turns into `{ error }` with that status
export const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};
