/// <reference types="vite/client" />

// Electron API types
interface ElectronAPI {
  db: {
    query: (query: string, params?: any) => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    updateConfig: (config: {
      server: string;
      database: string;
      user: string;
      password: string;
    }) => Promise<{
      success: boolean;
      error?: string;
    }>;
  };
  app: {
    getVersion: () => Promise<string>;
    getPath: (name: string) => Promise<string>;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
