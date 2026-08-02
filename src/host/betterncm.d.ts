// Ambient declarations for the BetterNCM plugin environment (CEF 91 page).

declare const betterncm: {
  fs: {
    readFileText(path: string): Promise<string>;
    writeFileText(path: string, content: string): Promise<boolean>;
    exists(path: string): Promise<boolean>;
  };
  app: {
    getDataPath(): Promise<string>;
    showConsole(show?: boolean): Promise<void>;
  };
  ncm: {
    openUrl(url: string): void;
  };
  utils: {
    waitForElement(selector: string, interval?: number): Promise<HTMLElement | null>;
    debounce<T extends (...args: never[]) => void>(fn: T, wait: number): T;
  };
};

declare const betterncm_native: {
  native_plugin: {
    call(identifier: string, args: readonly unknown[]): string;
    getRegisteredAPIs?(): string[];
  };
};

declare const plugin: {
  onLoad(fn: () => void): void;
  onConfig(fn: () => HTMLElement): void;
  pluginPath?: string;
  manifest?: { version?: string };
};

declare const loadedPlugins: Record<string, { pluginPath?: string } | undefined> | undefined;
