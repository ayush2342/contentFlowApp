import crypto from 'crypto';
import { env } from '../config/env.js';

const sessionStore = new Map();

const isExpired = (session) =>
  Date.now() - session.createdAt > env.outputSessionTtlSeconds * 1000;

export const createOutputSession = (payload) => {
  const outputId = crypto.randomBytes(8).toString('hex');
  const session = {
    outputId,
    ...payload,
    createdAt: Date.now(),
  };
  sessionStore.set(outputId, session);
  return session;
};

export const getOutputSession = (outputId) => {
  const session = sessionStore.get(outputId);
  if (!session) return null;

  if (isExpired(session)) {
    sessionStore.delete(outputId);
    return null;
  }

  return session;
};
