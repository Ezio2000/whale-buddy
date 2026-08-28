import type { WhaleApi } from './types';

declare global {
  interface Window {
    whale: WhaleApi;
  }
}

export {};
