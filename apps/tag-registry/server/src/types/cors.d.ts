declare module 'cors' {
  import { RequestHandler } from 'express';
  function cors(options?: Record<string, unknown>): RequestHandler;
  export = cors;
}
