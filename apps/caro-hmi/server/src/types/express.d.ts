declare global {
  namespace Express {
    interface Request {
      user?: { user_id: string; username: string; role: string };
    }
  }
}
export {};
