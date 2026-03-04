import type { Response } from 'express';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }

  static badRequest(message: string): ApiError {
    return new ApiError(400, message);
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, message);
  }

  static internal(error: unknown): ApiError {
    const msg = error instanceof Error ? error.message : String(error);
    return new ApiError(500, msg);
  }

  toResponse(res: Response) {
    return res.status(this.status).json({ error: this.message });
  }
}
